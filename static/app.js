// 変更済み app.js - クリックで可視星を観測欄に入れる処理を追加
async function fetchVisible() {
  const lat = parseFloat(document.getElementById('lat').value);
  const lon = parseFloat(document.getElementById('lon').value);
  const time = document.getElementById('time').value;

  const res = await fetch('/api/visible_stars', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({lat, lon, time})
  });
  const data = await res.json();
  if (data.error) {
    alert(data.error);
    return;
  }
  const list = data.visible;
  const container = document.getElementById('visibleList');
  if (list.length === 0) {
    container.innerHTML = '<p>可視な星が見つかりませんでした（高度や時刻を変えてください）</p>';
  } else {
    let html = '<table id="visibleTable"><tr><th>星名</th><th>等級</th><th>高度(°)</th><th>方位(°)</th></tr>';
    for (const s of list) {
      // tr に data-star をつけてクリック時に使えるようにする
      html += `<tr data-star="${s.id}"><td>${s.id}</td><td>${s.mag}</td><td>${s.alt_deg}</td><td>${s.az_deg}</td></tr>`;
    }
    html += '</table>';
    container.innerHTML = html;
  }

  // 観測入力欄（選択肢を可視星＋全星で用意）
  const obsDiv = document.getElementById('obsList');
  const allStars = data.all_stars;
  // 3行用意（UIから増やすことも可能に）
  let obsHtml = '';
  for (let i=1;i<=3;i++) {
    obsHtml += `<div class="obsRow">
      <label>恒星${i}: <select id="star${i}"></select></label>
      <label>観測時刻 (ISO, 秒含め可): <input id="time${i}" type="text" value="${document.getElementById('time').value}"></label>
      <label>高度 度: <input id="deg${i}" type="number" step="1" min="0" value=""></label>
      <label>高度 分.1位: <input id="min${i}" type="number" step="0.1" min="0" max="59.9" value=""></label>
    </div>`;
  }
  obsDiv.innerHTML = obsHtml;

  // セレクトに星リストを入れる
  for (let i=1;i<=3;i++) {
    const sel = document.getElementById('star'+i);
    sel.innerHTML = '';
    for (const name of allStars) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.text = name;
      sel.appendChild(opt);
    }
  }

  // テーブル行をクリック可能にする（ここで行要素が DOM に存在するのでイベントを付ける）
  const table = document.getElementById('visibleTable');
  if (table) {
    // 既存の selection があれば一旦解除する helper
    function clearRowSelection() {
      const rows = table.querySelectorAll('tr.selected');
      rows.forEach(r => r.classList.remove('selected'));
    }

    table.querySelectorAll('tr[data-star]').forEach(row => {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        const starName = row.getAttribute('data-star');
        // ハイライトの切り替え
        clearRowSelection();
        row.classList.add('selected');
        // 実際に観測欄へ入れる
        onStarRowClick(starName);
      });
    });
  }
}

// クリックした星名を 1..3 の観測欄のうち「度/分が空の最初の欄」に入れる
function onStarRowClick(starName) {
  for (let i = 1; i <= 3; i++) {
    const deg = document.getElementById('deg' + i).value;
    const min = document.getElementById('min' + i).value;
    // deg と min の両方が未入力（''）ならここに入れる
    if ((deg === '' || deg === null) && (min === '' || min === null)) {
      document.getElementById('star' + i).value = starName;
      // 観測時刻も自動で入れたい場合は次の行を有効（コメント解除）
      // document.getElementById('time' + i).value = document.getElementById('time').value;
      return;
    }
  }
  // すべて埋まっていたら star1 を上書きする（必要なら確認ダイアログを入れる）
  document.getElementById('star1').value = starName;
}

// --- 以降は computeFix 等の既存関数 ---
function buildObservations() {
  const obs = [];
  for (let i=1;i<=3;i++) {
    const star = document.getElementById('star'+i).value;
    const time = document.getElementById('time'+i).value;
    const degVal = document.getElementById('deg'+i).value;
    const minVal = document.getElementById('min'+i).value;
    if (degVal !== '' && minVal !== '') {
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
  const initLat = parseFloat(document.getElementById('lat').value);
  const initLon = parseFloat(document.getElementById('lon').value);
  const eye = parseFloat(document.getElementById('eye').value);
  const press = parseFloat(document.getElementById('press').value);
  const temp = parseFloat(document.getElementById('temp').value);

  const obs = buildObservations();
  if (obs.length < 1) {
    alert('少なくとも1つの観測を入力してください（推奨は3つ）');
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

  const res = await fetch('/api/compute_fix', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.error) {
    alert(data.error + (data.message ? '\n' + data.message : ''));
    return;
  }

  const area = document.getElementById('resultArea');
  let html = `<p>推定位置: 緯度 ${data.estimated_lat}°, 経度 ${data.estimated_lon}°（RMSE: ${data.rmse_nm} 海里）</p>`;
  html += '<table><tr><th>星名</th><th>Hs (°)</th><th>Hc (°)</th><th>intercept (海里)</th><th>Zn (°)</th></tr>';
  for (const d of data.details) {
    html += `<tr>
      <td>${d.star_id}</td>
      <td>${d.Hs_deg}</td>
      <td>${d.Hc_deg}</td>
      <td>${d.intercept_nm}</td>
      <td>${d.Zn_deg}</td>
    </tr>`;
  }
  html += '</table>';
  area.innerHTML = html;
}

document.getElementById('btnVisible').addEventListener('click', fetchVisible);
document.getElementById('btnCompute').addEventListener('click', computeFix);

// 初期化
fetchVisible();