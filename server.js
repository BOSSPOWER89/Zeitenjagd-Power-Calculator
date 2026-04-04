// server.js
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());


const CLIENT_ID = "Acw-ECxOopLqk9yWFd2nl-V8pK3f8jAouUrOzZXu4vUCIQBJS145u0SuL4RrBqYwQsRZ_yDW49VFd-mi";
const SECRET = "EDOzs4P2MasK-ik0paQ47P3kRtGUtzxrUF9_w1ffG_7ckis5KTewtPE8GSnzvPb9DM1md_wrmRnX1Gq5";


// =========================
// HELPER
// =========================
function massFactorForGear(gear, vehicleMass) {
  const base = {3:1.11,4:1.08,5:1.064,6:1.055,7:1.05}[gear];
  return (base - 1) * (1500 / vehicleMass) + 1;
}

function calculateMotorPowerPS(
  vehicleMass,
  driverMass,
  massFactor,
  time,
  midSpeedKmh,
  cw,
  area,
  pressure,
  temp,
  drivetrainForce,
  slopePercent
) {
  const g = 9.81;
  const v = midSpeedKmh / 3.6;
  const a = (10 / 3.6) / time;

  const airDensity =
    (pressure * 100) / (287.05 * (temp + 273.15));

  const F =
    (vehicleMass * massFactor + driverMass) * a +
    (vehicleMass + driverMass) * g * (slopePercent / 100) +
    (airDensity / 2) * cw * area * v * v +
    drivetrainForce;

  return (F * v / 1000) * 1.36;
}

function calculateDrivetrainFinal(vehicleMass, driverMass, ps1, dsg, awd) {

  let F1 = 975;

  if (!dsg) F1 -= 50;
  if (!awd) F1 -= 75;

  F1 -= 0.017 * 1600 * 9.81;

  let exponent =
    ps1 <= 1000 ? 0.7 :
    ps1 >= 1600 ? 0.8 :
    0.7 + (ps1 - 1000) * (0.1 / 600);

  const F2 = F1 * Math.pow(ps1 / 400, exponent);
  const F3 = F2 + 0.017 * (vehicleMass + driverMass) * 9.81;

  let k =
    ps1 <= 1000 ? 75 :
    ps1 >= 1600 ? 100 :
    75 + (ps1 - 1000) * (25 / 600);

  return F3 + (ps1 - 400) / 400 * k;
}


async function verifyPayPal(orderID){

  const auth = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(CLIENT_ID + ":" + SECRET).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const authData = await auth.json();
  const accessToken = authData.access_token;

  const res = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${orderID}`, {
    headers: {
      "Authorization": `Bearer ${accessToken}`
    }
  });

  const data = await res.json();

  return data.status === "COMPLETED";
}

// =========================
// MAIN CALC
// =========================
app.post("/calc", async (req, res) => {

  const { orderID } = req.body;

if(!orderID){
  return res.status(400).json({ error: "Keine Zahlung!" });
}

const valid = await verifyPayPal(orderID);

if(!valid){
  return res.status(403).json({ error: "Zahlung ungültig!" });
}

  const {
    mass,
    driver,
    cw,
    area,
    pressure,
    temp,
    slope,
    dsg,
    awd,
    showRpmNm,
    intervals,
    gearRefs
  } = req.body;

  let psList = [];

  // 1️⃣ Roh PS sammeln
  intervals.forEach(i => {
    const ps1 = calculateMotorPowerPS(
      mass,
      driver,
      massFactorForGear(i.gear, mass),
      i.time,
      i.mid,
      cw,
      area,
      pressure,
      temp,
      100,
      slope
    );

    psList.push(ps1);
  });

  if(psList.length === 0){
    return res.json({ error: "No intervals" });
  }

  let psCurrent = Math.max(...psList);
  let drivetrainFinal = 0;

  // 2️⃣ Iteration
  for (let x = 0; x < 5; x++) {

    drivetrainFinal = calculateDrivetrainFinal(
      mass,
      driver,
      psCurrent,
      dsg,
      awd
    );

    let newList = [];

    intervals.forEach(i => {
      const ps = calculateMotorPowerPS(
        mass,
        driver,
        massFactorForGear(i.gear, mass),
        i.time,
        i.mid,
        cw,
        area,
        pressure,
        temp,
        drivetrainFinal,
        slope
      );

      newList.push(ps);
    });

    const newMax = Math.max(...newList);

    if (Math.abs(newMax - psCurrent) < 1) break;

    psCurrent = newMax;
  }

  // 3️⃣ Final Results
  let results = [];

  intervals.forEach(i => {

    const ps = calculateMotorPowerPS(
      mass,
      driver,
      massFactorForGear(i.gear, mass),
      i.time,
      i.mid,
      cw,
      area,
      pressure,
      temp,
      drivetrainFinal,
      slope
    );

    let rpm = "-";
    let nm = "-";

    if(showRpmNm){
      const ref = gearRefs[i.gear];

      if(ref){
        const r = (i.mid / ref) * 3000;
        rpm = Math.round(r);
        nm = Math.round((ps * 7023) / r);
      }
    }

    results.push({
      label: i.label,
      time: i.time,
      ps: Math.round(ps),
      rpm,
      nm
    });
  });

  const max = Math.max(...results.map(r => r.ps));

  res.json({
    max,
    results
  });

});


// =========================
// START
// =========================
app.listen(3000, () => {
  console.log("Server läuft auf 3000");
});