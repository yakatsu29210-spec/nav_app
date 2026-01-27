let obsCount = 0;
const MAX_OBS = 3;

function loadVisibleStars() {
    fetch("/api/visible_stars", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            lat: document.getElementById("lat").value,
            lon: document.getElementById("lon").value,
            time: document.getElementById("time").value + "Z"
        })
    })
    .then(r => r.json())
    .then(d => {
        const sel = document.getElementById("visible-stars");
        sel.innerHTML = "";

        d.visible.forEach(s => {
            const o = document.createElement("option");
            o.value = s.id;
            o.textContent = `${s.id} (HIP ${s.hip}) Alt ${s.alt_deg}`;
            sel.appendChild(o);
        });
    });
}

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
    document.querySelectorAll("#visible-stars option").forEach(o => {
        starSel.appendChild(o.cloneNode(true));
    });

    c.appendChild(div);
    obsCount++;

    if (obsCount >= MAX_OBS) {
        document.getElementById("add-btn").disabled = true;
    }
}

function computeFix() {
    const obs = [];
    document.querySelectorAll("#obs-container .grid").forEach(g => {
        obs.push({
            type: g.querySelector(".body").value,
            id: g.querySelector(".star").value,
            deg: g.children[2].value,
            min: g.children[3].value,
            time: document.getElementById("time").value + "Z"
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
        document.getElementById("result").textContent =
            JSON.stringify(d, null, 2);
    });
}
