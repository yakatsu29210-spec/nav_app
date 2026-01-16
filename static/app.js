// static/app.js (既存の app.js を置き換えるか、以下の変更をマージしてください)
// このファイルは I18N を window.I18N から参照、言語メニューの開閉制御を追加しています.

// --- I18N (templates から渡される) ---
const I18N = window.I18N || {};
const CURRENT_LANG = window.CURRENT_LANG || 'ja';

// 小さなヘルパー
function t(key, fallback='') {
  return (I18N && I18N[key]) ? I18N[key] : fallback || key;
}

// 言語ドロップダウンの挙動
document.addEventListener('DOMContentLoaded', () => {
  const langToggle = document.getElementById('langToggle');
  const langMenu = document.getElementById('langMenu');
  if (langToggle && langMenu) {
    const dropdown = document.getElementById('langDropdown');
    langToggle.addEventListener('click', (e) => {
      const open = langMenu.classList.toggle('open');
      langToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      dropdown.setAttribute('aria-hidden', open ? 'false' : 'true');
    });
    // メニューの外側をクリックしたら閉じる
    document.addEventListener('click', (e) => {
      if (!langMenu.contains(e.target)) {
        langMenu.classList.remove('open');
        langToggle.setAttribute('aria-expanded', 'false');
        dropdown.setAttribute('aria-hidden', 'true');
      }
    });
  }

  // イベント登録（ボタン類）
  const btnVisible = document.getElementById('btnVisible');
  if (btnVisible) btnVisible.addEventListener('click', fetchVisible);
  const btnCompute = document.getElementById('btnCompute');
  if (btnCompute) btnCompute.addEventListener('click', computeFix);

  // 初期処理
  fetchVisible();
});

// --- fetchVisible / computeFix / buildObservations の実装 ---
// 既存のアプリではこれらが既にあるはずです。ここでは前回提示したロジックをベースにしています。

async function fetchVisible() {
  const lat = parseFloat(document.getElementById('lat')?.value || 35.0);
  const lon = parseFloat(document.getElementById('lon')?.value || 135.0);
  const time = document.getElementById('time')?.value || '';

  try {
    const res = await fetch('/api/visible_stars', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({lat, lon, time})
    });
    const data = await res.json();
    if (data.error) {
      alert(t('api_error', 'Server error'));
      return;
    }
    const list = data.visible || [];
    const container = document.getElementById('visibleList');
    if (!container) return;
    if (list.length === 0) {
      container.innerHTML = `<p>${t('visible_none', 'No visible stars found')}</p>`;
    } else {
      let html = '<div class="visible-list"><table id="visibleTable"><tr><th>星名</th><th>等級</th><th>高度(°)</th><th>方位(°)</th></tr>';
      for (const s of list) {
        html += `<tr data-star="${s.id}"><td>${s.id}</td><td>${s.mag}</td><td>${s.alt_deg}</td><td>${s.az_deg}</td></tr>`;
      }
      html += '</table></div>';
      container.innerHTML = html;
    }

    // 観測入力欄（3行） を作成（既にあるなら上書き）
    const obsDiv = document.getElementById('obsList');
    if (obsDiv) {
      let obsHtml = '';
      for (let i=1;i<=3;i++) {
        obsHtml += `<div class="obsRow">
          <label>恒星${i}: <select id="star${i}"></select></label>
          <label>観測時刻: <input id="time${i}" type="text" value="${document.getElementById('time')?.value || ''}"></label>
          <label>高度 度: <input id="deg${i}" type="number" step="1" min="0" value=""></label>
          <label>高度 分: <input id="min${i}" type="number" step="0.1" min="0" max="59.9" value=""></label>
        </div>`;
      }
      obsDiv.innerHTML = obsHtml;

      // セレクトに星リストを入れる（all_stars があれば）
      const allStars = data.all_stars || list.map(s=>s.id);
      for (let i=1;i<=3;i++) {
        const sel = document.getElementById('star'+i);
        if (!sel) continue;
        sel.innerHTML = '';
        for (const name of allStars) {
          const opt = document.createElement('option');
          opt.value = name;
          opt.text = name;
          sel.appendChild(opt);
        }
      }
    }

    // テーブル行クリックで観測欄へ入れる
    const table = document.getElementById('visibleTable');
    if (table) {
      function clearRowSelection() {
        const rows = table.querySelectorAll('tr.selected');
        rows.forEach(r => r.classList.remove('selected'));
      }
      table.querySelectorAll('tr[data-star]').forEach(row => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
          const starName = row.getAttribute('data-star');
          clearRowSelection();
          row.classList.add('selected');
          onStarRowClick(starName);
        });
      });
    }

  } catch (e) {
    console.error(e);
    alert(t('api_error', 'Server error'));
  }
}

function onStarRowClick(starName) {
  for (let i = 1; i <= 3; i++) {
    const deg = document.getElementById('deg' + i)?.value;
    const min = document.getElementById('min' + i)?.value;
    if ((deg === '' || deg === null || typeof deg === 'undefined') && (min === '' || min === null || typeof min === 'undefined')) {
      const sel = document.getElementById('star' + i);
      if (sel) sel.value = starName;
      return;
    }
  }
  const sel1 = document.getElementById('star1');
  if (sel1) sel1.value = starName;
}

function buildObservations() {
  const obs = [];
  for (let i=1;i<=3;i++) {
    const star = document.getElementById('star'+i)?.value;
    const time = document.getElementById('time'+i)?.value;
    const degVal = document.getElementById('deg'+i)?.value;
    const minVal = document.getElementById('min'+i)?.value;
    if (degVal !== '' && minVal !== '' && typeof degVal !== 'undefined' && typeof minVal !== 'undefined') {
      obs.push({
        star_id: star,
        time: time,
        deg: parseFloat(degVal),
        min: parseFloat(minVal)
      });
    }
  }
  return obs;
}

async function computeFix() {
  const initLat = parseFloat(document.getElementById('lat')?.value || 35.0);
  const initLon = parseFloat(document.getElementById('lon')?.value || 135.0);
  const eye = parseFloat(document.getElementById('eye')?.value || 3.0);
  const press = parseFloat(document.getElementById('press')?.value || 1013.0);
  const temp = parseFloat(document.getElementById('temp')?.value || 15.0);

  const obs = buildObservations();
  if (obs.length < 1) {
    alert(t('alert_need_obs', 'Please enter at least one observation'));
    return;
  }

  const body = {
    initial_lat: initLat,
    initial_lon: initLon,
    eye_height_m: eye,
    pressure_hpa: press,
    temp_c: temp,
    observations: obs
  };

  try {
    const res = await fetch('/api/compute_fix', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) {
      alert(t('api_error', 'Server error'));
      return;
    }

    const area = document.getElementById('resultArea');
    let html = `<p>推定位置: 緯度 ${data.estimated_lat}°, 経度 ${data.estimated_lon}°（RMSE: ${data.rmse_nm} 海里）</p>`;
    html += '<table><tr><th>星名</th><th>Hs (°)</th><th>Hc (°)</th><th>intercept (海里)</th><th>Zn (°)</th></tr>';
    for (const d of data.details || []) {
      html += `<tr>
        <td>${d.star_id}</td>
        <td>${d.Hs_deg}</td>
        <td>${d.Hc_deg}</td>
        <td>${d.intercept_nm}</td>
        <td>${d.Zn_deg}</td>
      </tr>`;
    }
    html += '</table>';
    if (area) area.innerHTML = html;
  } catch (e) {
    console.error(e);
    alert(t('api_error', 'Server error'));
  }
}
