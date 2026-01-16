from flask import Flask, request, jsonify, render_template
from skyfield.api import load, Topos, Star
from math import sqrt, tan, radians
import datetime
import pytz
import numpy as np
from scipy.optimize import minimize

app = Flask(__name__, static_folder='static', template_folder='templates')

# 既存の /api/visible_stars, /api/compute_fix などのルートはそのまま残して下さい。
# このブロックはテンプレートに翻訳関数 `_()` と JS 用の I18N_JSON を注入し、
# /set_language/<lang> ルートを追加します。

import json
from flask import request, redirect, url_for, make_response, g

# --- simple i18n dictionary ---
I18N = {
    'ja': {
        'title': '天測計算援助Webアプリ',
        'header': '天測計算援助Webアプリ',
        'step1': 'ステップ1: 推測位置・時刻 → 可視恒星表示',
        'lat': '緯度 (°):',
        'lon': '経度 (°):',
        'time': '大まかな時刻 (UTC):',
        'btn_visible': '可視恒星表示',
        'step2': 'ステップ2: 眼高・気象',
        'eye': '眼高 (m):',
        'press': '気圧 (hPa):',
        'temp': '気温 (°C):',
        'step3': 'ステップ3: 3つの観測値を入力',
        'btn_compute': '位置計算（3観測以上）',
        'footer': 'Skyfield を使用した研究用プロトタイプです。',
        'alert_need_obs': '少なくとも1つの観測を入力してください（推奨は3つ）',
        'visible_none': '可視な星が見つかりませんでした（高度や時刻を変えてください）',
        'api_error': 'サーバーエラーが発生しました'
    },
    'en': {
        'title': 'Celestial Navigation Prototype (Improved)',
        'header': 'Celestial Navigation Prototype (Improved)',
        'step1': 'Step 1: Initial position/time → Get visible stars',
        'lat': 'Latitude (°):',
        'lon': 'Longitude (°):',
        'time': 'Approx. time (ISO, UTC recommended):',
        'btn_visible': 'Get visible stars',
        'step2': "Step 2: Eye height & weather",
        'eye': 'Eye height (m):',
        'press': 'Pressure (hPa):',
        'temp': 'Temperature (°C):',
        'step3': 'Step 3: Enter 3 observations (choose stars from visible list)',
        'btn_compute': 'Compute position (3+ obs)',
        'footer': 'Research prototype using Skyfield. Validate thoroughly before public navigation use.',
        'alert_need_obs': 'Please enter at least one observation (3 recommended)',
        'visible_none': 'No visible stars found (try different time/position)',
        'api_error': 'Server error occurred'
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
        return I18N.get(g.get('lang', DEFAULT_LANG), {}).get(key, key)
    i18n_json = json.dumps(I18N.get(g.get('lang', DEFAULT_LANG), {}), ensure_ascii=False)
    return dict(_=_, I18N_JSON=i18n_json, CURRENT_LANG=g.get('lang', DEFAULT_LANG))

@app.route('/set_language/<lang>')
def set_language(lang):
    next_url = request.args.get('next') or url_for('index')
    if lang not in I18N:
        lang = DEFAULT_LANG
    resp = make_response(redirect(next_url))
    resp.set_cookie('lang', lang, max_age=60*60*24*365)
    return resp

# --- 簡易星表（代表的な明るい星） ---
STAR_CATALOG = [
    {"id": "Sirius", "ra_h": 6.752477, "dec_deg": -16.716116, "mag": -1.46},
    {"id": "Canopus", "ra_h": 6.399199, "dec_deg": -52.695662, "mag": -0.74},
    {"id": "Arcturus", "ra_h": 14.260668, "dec_deg": 19.1825, "mag": -0.05},
    {"id": "Vega", "ra_h": 18.615649, "dec_deg": 38.78369, "mag": 0.03},
    {"id": "Capella", "ra_h": 5.278155, "dec_deg": 45.998028, "mag": 0.08},
    {"id": "Rigel", "ra_h": 5.242298, "dec_deg": -8.201639, "mag": 0.12},
    {"id": "Betelgeuse", "ra_h": 5.919529, "dec_deg": 7.407064, "mag": 0.42},
    {"id": "Procyon", "ra_h": 7.655033, "dec_deg": 5.225, "mag": 0.38},
    {"id": "Achernar", "ra_h": 1.628571, "dec_deg": -57.236667, "mag": 0.46},
    {"id": "Altair", "ra_h": 19.846389, "dec_deg": 8.868322, "mag": 0.77},
    {"id": "Aldebaran", "ra_h": 4.598677, "dec_deg": 16.509167, "mag": 0.85},
    {"id": "Antares", "ra_h": 16.490128, "dec_deg": -26.431944, "mag": 1.06},
    {"id": "Spica", "ra_h": 13.419694, "dec_deg": -11.161389, "mag": 0.98},
    {"id": "Fomalhaut", "ra_h": 22.960827, "dec_deg": -29.6225, "mag": 1.16},
    {"id": "Deneb", "ra_h": 20.690278, "dec_deg": 45.280278, "mag": 1.25},
    {"id": "Pollux", "ra_h": 7.755278, "dec_deg": 28.026111, "mag": 1.14},
    {"id": "Regulus", "ra_h": 10.139444, "dec_deg": 11.967222, "mag": 1.35},
]

ts = load.timescale()
eph = load('de421.bsp')  # 初回はダウンロードあり

# Star オブジェクト作成
for s in STAR_CATALOG:
    s["star_obj"] = Star(ra_hours=s["ra_h"], dec_degrees=s["dec_deg"])


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/visible_stars', methods=['POST'])
def visible_stars():
    data = request.get_json()
    try:
        lat = float(data.get('lat'))
        lon = float(data.get('lon'))
        time_str = data.get('time')
    except Exception:
        return jsonify({"error": "invalid lat/lon/time"}), 400

    # 時刻パース
    try:
        if time_str.endswith('Z'):
            dt = datetime.datetime.fromisoformat(time_str.replace('Z', '+00:00'))
        else:
            dt = datetime.datetime.fromisoformat(time_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=pytz.UTC)
    except Exception:
        return jsonify({"error": "invalid time format"}), 400

    t = ts.from_datetime(dt.astimezone(pytz.UTC))
    observer = eph['earth'] + Topos(latitude_degrees=lat, longitude_degrees=lon)

    visible = []
    for s in STAR_CATALOG:
        astrometric = observer.at(t).observe(s["star_obj"])
        apparent = astrometric.apparent()
        alt, az, distance = apparent.altaz()
        alt_deg = alt.degrees
        az_deg = az.degrees
        # 可視基準: 高度 > 2.0° かつ等級 <= 5.0（調整可）
        if alt_deg > 2.0 and s["mag"] <= 5.0:
            visible.append({
                "id": s["id"],
                "mag": s["mag"],
                "alt_deg": round(alt_deg, 2),
                "az_deg": round(az_deg, 1),
            })
    visible.sort(key=lambda x: -x["alt_deg"])
    return jsonify({"time_utc": t.utc_iso(), "visible": visible, "all_stars": [s["id"] for s in STAR_CATALOG]})


def dip_correction_degrees(eye_height_m):
    if eye_height_m <= 0:
        return 0.0
    dip_min = 1.76 * sqrt(eye_height_m)
    return - (dip_min / 60.0)


def refraction_correction_degrees(alt_deg, pressure_hpa, temp_c):
    if alt_deg < -1.0:
        return 0.0
    alt_rad = radians(max(alt_deg, 0.1))
    try:
        R_deg = 0.00452 * pressure_hpa / (273.0 + temp_c) / tan(alt_rad)
    except Exception:
        R_deg = 0.0
    return R_deg


def compute_Hc(lat, lon, star_obj, t):
    observer = eph['earth'] + Topos(latitude_degrees=lat, longitude_degrees=lon)
    astrometric = observer.at(t).observe(star_obj)
    apparent = astrometric.apparent()
    alt, az, distance = apparent.altaz()
    return alt.degrees, az.degrees


@app.route('/api/compute_fix', methods=['POST'])
def compute_fix():
    """
    JSON inputs:
    {
      "initial_lat": 35.0,
      "initial_lon": 135.0,
      "eye_height_m": 3.0,
      "pressure_hpa": 1013.0,
      "temp_c": 15.0,
      "observations": [
         {
           "star_id": "Sirius",
           "time": "2026-01-15T21:30:12Z",
           "deg": 25,
           "min": 30.4
         }, ...
      ]
    }
    """
    data = request.get_json()
    try:
        init_lat = float(data.get('initial_lat'))
        init_lon = float(data.get('initial_lon'))
        eye_h = float(data.get('eye_height_m', 0.0))
        pressure = float(data.get('pressure_hpa', 1013.0))
        temp = float(data.get('temp_c', 15.0))
        observations = data.get('observations', [])
    except Exception:
        return jsonify({"error": "invalid input"}), 400

    if len(observations) < 1:
        return jsonify({"error": "少なくとも1つの観測が必要です"}), 400

    # 前処理：各観測に star_obj, observed_alt_deg, ts time を付与
    proc_obs = []
    for obs in observations:
        sid = obs.get('star_id')
        star = next((s for s in STAR_CATALOG if s["id"] == sid), None)
        if star is None:
            return jsonify({"error": f"star not found: {sid}"}), 400
        time_str = obs.get('time')
        try:
            if time_str.endswith('Z'):
                dt = datetime.datetime.fromisoformat(time_str.replace('Z', '+00:00'))
            else:
                dt = datetime.datetime.fromisoformat(time_str)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=pytz.UTC)
        except Exception:
            return jsonify({"error": f"invalid time format for {sid}"}), 400
        t = ts.from_datetime(dt.astimezone(pytz.UTC))
        deg = float(obs.get('deg', 0.0))
        minute = float(obs.get('min', 0.0))
        observed_alt = deg + minute / 60.0
        proc_obs.append({
            "star": star,
            "star_obj": star["star_obj"],
            "time": t,
            "observed_alt_deg": observed_alt
        })

    dip = dip_correction_degrees(eye_h)

    # 目的関数：与えられた lat, lon に対して各観測の (Hs - Hc)*60 の二乗和を返す
    def objective(x):
        lat, lon = x[0], x[1]
        s = 0.0
        for p in proc_obs:
            observed_alt = p["observed_alt_deg"]
            R = refraction_correction_degrees(observed_alt, pressure, temp)
            Hs = observed_alt + dip + R
            Hc, _ = compute_Hc(lat, lon, p["star_obj"], p["time"])
            # 差を海里に変換
            d_nm = (Hs - Hc) * 60.0
            s += d_nm * d_nm
        return s

    # 最適化実行（初期値はユーザの推測位置）
    x0 = np.array([init_lat, init_lon])
    res = minimize(objective, x0, method='Nelder-Mead', options={'xatol':1e-6, 'fatol':1e-6, 'maxiter':1000})

    if not res.success:
        return jsonify({"error": "optimization failed", "message": res.message}), 500

    est_lat, est_lon = float(res.x[0]), float(res.x[1])

    # 詳細結果（各観測の残差など）
    details = []
    total_sq = 0.0
    for p in proc_obs:
        observed_alt = p["observed_alt_deg"]
        R = refraction_correction_degrees(observed_alt, pressure, temp)
        Hs = observed_alt + dip + R
        Hc, Zn = compute_Hc(est_lat, est_lon, p["star_obj"], p["time"])
        intercept_nm = (Hs - Hc) * 60.0
        details.append({
            "star_id": p["star"]["id"],
            "mag": p["star"]["mag"],
            "Hs_deg": round(Hs, 5),
            "Hc_deg": round(Hc, 5),
            "intercept_nm": round(intercept_nm, 4),
            "Zn_deg": round(Zn, 3)
        })
        total_sq += intercept_nm * intercept_nm

    rmse_nm = np.sqrt(total_sq / len(proc_obs))

    return jsonify({
        "estimated_lat": round(est_lat, 6),
        "estimated_lon": round(est_lon, 6),
        "rmse_nm": round(float(rmse_nm), 4),
        "details": details,
        "optimization_message": res.message
    })


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
