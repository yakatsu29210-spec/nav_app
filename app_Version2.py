from flask import Flask, request, jsonify, render_template, g
from flask import redirect, url_for, request, make_response
from skyfield.api import load, Topos, Star
from math import sqrt, tan, radians, cos, sin
import datetime
import numpy as np

app = Flask(__name__, static_folder='static', template_folder='templates')

# =====================================================
# Language switcher（templates互換）
# =====================================================
@app.route('/set_language/<lang>')
def set_language(lang):
    next_url = request.args.get('next', url_for('index'))

    if lang not in I18N:
        lang = DEFAULT_LANG

    resp = make_response(redirect(next_url))
    resp.set_cookie('lang', lang, max_age=60 * 60 * 24 * 365)
    return resp

# =====================================================
# i18n（templates 完全互換）
# =====================================================
import json
from flask import g

I18N = {
    'ja': {
        'title': '天文航法プロトタイプ',
    },
    'en': {
        'title': 'Celestial Navigation Prototype',
    }
}

DEFAULT_LANG = 'ja'


@app.before_request
def load_language():
    lang = request.cookies.get('lang')
    if not lang or lang not in I18N:
        lang = DEFAULT_LANG
    g.lang = lang


@app.context_processor
def inject_i18n():
    def _(key):
        return I18N.get(g.lang, {}).get(key, key)

    return dict(
        _=_,
        CURRENT_LANG=g.lang,
        I18N_JSON=json.dumps(I18N[g.lang], ensure_ascii=False)
    )

# =====================================================
# Index
# =====================================================
@app.route('/')
def index():
    return render_template('index.html')

# =====================================================
# Skyfield
# =====================================================
ts = load.timescale()
eph = load('de421.bsp')

SUN = eph['sun']
MOON = eph['moon']
PLANETS = {
    'Venus': eph['venus'],
    'Mars': eph['mars'],
    'Jupiter': eph['jupiter barycenter'],
    'Saturn': eph['saturn barycenter'],
}

# =====================================================
# 航海用恒星（拡張・HIP付き）
# =====================================================
STAR_CATALOG = [
    {"id": "Sirius", "hip": 32349, "ra_h": 6.75248, "dec_deg": -16.7161},
    {"id": "Canopus", "hip": 30438, "ra_h": 6.39920, "dec_deg": -52.6957},
    {"id": "Arcturus", "hip": 69673, "ra_h": 14.2607, "dec_deg": 19.1825},
    {"id": "Vega", "hip": 91262, "ra_h": 18.6156, "dec_deg": 38.7837},
    {"id": "Capella", "hip": 24608, "ra_h": 5.27816, "dec_deg": 45.9980},
    {"id": "Rigel", "hip": 24436, "ra_h": 5.24230, "dec_deg": -8.2016},
    {"id": "Procyon", "hip": 37279, "ra_h": 7.65503, "dec_deg": 5.2250},
    {"id": "Achernar", "hip": 7588, "ra_h": 1.62857, "dec_deg": -57.2367},
    {"id": "Betelgeuse", "hip": 27989, "ra_h": 5.91953, "dec_deg": 7.4071},
    {"id": "Altair", "hip": 97649, "ra_h": 19.8464, "dec_deg": 8.8683},
    {"id": "Aldebaran", "hip": 21421, "ra_h": 4.59868, "dec_deg": 16.5092},
    {"id": "Antares", "hip": 80763, "ra_h": 16.4901, "dec_deg": -26.4319},
    {"id": "Spica", "hip": 65474, "ra_h": 13.4197, "dec_deg": -11.1614},
    {"id": "Fomalhaut", "hip": 113368, "ra_h": 22.9608, "dec_deg": -29.6225},
    {"id": "Deneb", "hip": 102098, "ra_h": 20.6903, "dec_deg": 45.2803},
]

for s in STAR_CATALOG:
    s["obj"] = Star(ra_hours=s["ra_h"], dec_degrees=s["dec_deg"])

# =====================================================
# 補正
# =====================================================
def dip_correction(eye_m):
    return -1.76 * sqrt(eye_m) / 60.0 if eye_m > 0 else 0.0

def bennett_refraction(hs_deg, pressure, temp):
    if hs_deg <= 0:
        return 0.0
    alt = radians(max(hs_deg, 0.1))
    R = 1.02 / tan(alt + 10.3 / (hs_deg + 5.11))
    return R * (pressure / 1010.0) * (283.0 / (273.0 + temp)) / 60.0

def dr_position(lat0, lon0, course_deg, speed_kt, delta_hours):
    distance = speed_kt * delta_hours  # NM
    dlat = distance * cos(radians(course_deg)) / 60.0
    dlon = distance * sin(radians(course_deg)) / (60.0 * cos(radians(lat0)))
    return lat0 + dlat, lon0 + dlon

def compute_alt_az(lat, lon, body, t):
    obs = eph['earth'] + Topos(latitude_degrees=lat, longitude_degrees=lon)
    alt, az, _ = obs.at(t).observe(body).apparent().altaz()
    return alt.degrees, az.degrees

# =====================================================
# 可視天体（高度のみ）
# =====================================================
@app.route('/api/visible_stars', methods=['POST'])
def visible_stars():
    d = request.get_json()
    lat = float(d['lat'])
    lon = float(d['lon'])
    t = ts.from_datetime(datetime.datetime.fromisoformat(d['time'].replace('Z', '+00:00')))

    visible = []

    for s in STAR_CATALOG:
        alt, az = compute_alt_az(lat, lon, s["obj"], t)
        if alt > 2.0:
            visible.append({
                "id": s["id"],
                "hip": s["hip"],
                "alt_deg": round(alt, 2),
                "az_deg": round(az, 1)
            })

    return jsonify({"visible": visible})

# =====================================================
# LOP 位置計算（恒星・太陽・月・惑星対応）
# =====================================================
@app.route('/api/compute_fix', methods=['POST'])
def compute_fix():
    d = request.get_json()

    lat0 = float(d['initial_lat'])
    lon0 = float(d['initial_lon'])

    if not (-90 <= lat0 <= 90 and -180 <= lon0 <= 180):
        return jsonify({"error": "初期位置が不正です"}), 400

    course = float(d.get("course_deg", 0))
    speed = float(d.get("speed_kt", 0))
    base_time = datetime.datetime.fromisoformat(
    d["base_time"].replace("Z", "+00:00")
    )

    eye = float(d.get('eye_height_m', 0))
    p = float(d.get('pressure_hpa', 1013))
    temp = float(d.get('temp_c', 15))
    obs = d['observations']

    if len(obs) < 2:
        return jsonify({"error": "2観測以上が必要です"}), 400

    A, b = [], []

for o in obs:
    obs_time = datetime.time.fromisoformat(o["obs_time"])

    t_obs = datetime.datetime.combine(
        base_time.date(),
        obs_time,
        tzinfo=pytz.UTC
    )

    delta_h = (t_obs - base_time).total_seconds() / 3600.0

    lat_dr, lon_dr = dr_position(
        lat0,
        lon0,
        course,
        speed,
        delta_h
    )

    t = ts.from_datetime(t_obs)

    Hs = float(o["deg"]) + float(o["min"]) / 60.0
    Ho = Hs + dip_correction(eye) + bennett_refraction(Hs, p, temp)

    star = next(s for s in STAR_CATALOG if s["id"] == o["id"])

    Hc, Zn = compute_alt_az(lat_dr, lon_dr, star["star_obj"], t)

    a = (Ho - Hc) * 60.0

    A.append([cos(radians(Zn)), sin(radians(Zn))])
    b.append(a)


    A = np.array(A)
    b = np.array(b)

    x, *_ = np.linalg.lstsq(A, b, rcond=None)
    dx, dy = x

    lat = lat0 + dy / 60.0
    lon = lon0 + dx / (60.0 * cos(radians(lat0)))

    lat = max(-90, min(90, lat))
    lon = ((lon + 180) % 360) - 180

    residuals = A @ x - b
    err_nm = sqrt(np.mean(residuals ** 2))

    return jsonify({
        "estimated_lat": round(lat, 6),
        "estimated_lon": round(lon, 6),
        "error_radius_nm": round(err_nm, 3),
        "used_observations": len(obs)
    })

# =====================================================
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
