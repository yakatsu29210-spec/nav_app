function addRow() {
    const table = document.querySelector("#obs-table tbody");
    const row = table.rows[0].cloneNode(true);
    row.querySelectorAll("input").forEach(i => i.value = "");
    table.appendChild(row);
}

function computeFix() {
    const rows = document.querySelectorAll("#obs-table tbody tr");

    const observations = [];
    rows.forEach(r => {
        const inputs = r.querySelectorAll("input, select");
        observations.push({
            id: inputs[0].value,
            type: inputs[1].value,
            deg: inputs[2].value,
            min: inputs[3].value,
            time: inputs[4].value + "Z"
        });
    });

    const payload = {
        initial_lat: document.getElementById("init-lat").value,
        initial_lon: document.getElementById("init-lon").value,
        eye_height_m: document.getElementById("eye").value,
        pressure_hpa: document.getElementById("pressure").value,
        temp_c: document.getElementById("temp").value,
        observations: observations
    };

    fetch("/api/compute_fix", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(d => {
        document.getElementById("result").textContent =
            JSON.stringify(d, null, 2);
    })
    .catch(e => {
        document.getElementById("result").textContent = e;
    });
}
