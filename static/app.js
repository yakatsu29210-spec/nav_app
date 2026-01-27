let obsCount = 0;
const MAX_OBS = 3;
let visibleStarsCache = [];

/* UTC変換 */
function localToUTCISOString(localValue) {
    return new Date(localValue).toISOString();
}

/* 可視恒星取得 */
function loadVisibleStars() {
    fetch("/api/visible_stars", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            lat: document.getElementById("lat").value,
            lon: document.getElementById("lon").value,
            time: localToUTCISOString(document.getElementById("time").value)
        })
    })
    .then(r => r.json())
    .then(d => {
        visibleStarsCache = d.visible;
        renderVisibleList();
    });
}

/* 可視恒星一覧描画 */
function renderVisibleList() {
    const list = document.getElementById("visible-list");
    list.innerHTML = "";

    visibleStarsCache.forEach(s => {
        const row = document.createElement("div");
        row.className = "star-row";
        row.innerHTML = `
            <span>${s.id}</span>
            <span>HIP ${s.hip}</span>
            <span>Alt ${s.alt_deg}°</span>
            <span>Az ${s.az_deg}°</span>
        `;
        row.onclick = () => selectStar(s.id);
        list.appendChild(row);
    });
}

/* 観測入力追加 */
function addObservation() {
    if (obsCount >= MAX_OBS) return;

    const c = document.getElementById("obs-container");
    const div = document.createElement("div");
    div.className = "grid";

    div.innerHTML = `
        <select class="body">
            <option value="star">Star</option>
            <option value="sun">Sun</option>
            <option value="moon">Moon</option>
            <option value="Venus">Venus</option>
            <option value="Mars">Mars</option>
        </select>

        <select class="star"></select>
        <input type="number" placeholder="deg">
        <input type="number" step="0.1" placeholder="min">
    `;

    const starSel = div.querySelector(".star");
    visibleStarsCache.forEach(s => {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.id;
        starSel.appendChild(o);
    });

    c.appendChild(div);
    obsCount++;

    if (obsCount >= MAX_OBS) {
        document.getElementById("add-btn").disabled = true;
    }
}

/* 一覧から恒星選択 */
function selectStar(starId) {
    const last = document.querySelector("#obs-container .grid:last-child select.star");
    if (last) {
        last.value = starId;
    }
}

/* 位置計算 */
function computeFix() {
    const obs = [];
    document.querySelectorAll("#obs-container .grid").forEach(g => {
        obs.push({
            type: g.querySelector(".body").value,
            id: g.querySelector(".star").value,
            deg: g.children[2].value,
            min: g.children[3].value,
            time: localToUTCISOString(document.getElementById("time").value)
        });
    });

    fetch("/api/compute_fix", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            initial_lat: document.getElementById("lat").value,
            initial_lon: document.getElementById("lon").value,
            observations: obs
        })
    })
    .then(r => r.json())
    .then(d => {
    document.getElementById("res-lat").textContent =
        formatLat(d.estimated_lat);

    document.getElementById("res-lon").textContent =
        formatLon(d.estimated_lon);

    document.getElementById("res-obs").textContent =
        `${d.used_observations} bodies`;

    document.getElementById("res-err").textContent =
        `±${d.error_radius_nm} NM`;
　　});
}

function formatLat(lat) {
    const dir = lat >= 0 ? "N" : "S";
    lat = Math.abs(lat);
    const d = Math.floor(lat);
    const m = ((lat - d) * 60).toFixed(3);
    return `${d}° ${m}′ ${dir}`;
}

function formatLon(lon) {
    const dir = lon >= 0 ? "E" : "W";
    lon = Math.abs(lon);
    const d = Math.floor(lon);
    const m = ((lon - d) * 60).toFixed(3);
    return `${d}° ${m}′ ${dir}`;
}
