export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const token = process.env.NOTION_TOKEN;
  const dbId = "a4f674b8d9274089a8096f4c26e42522"; // Suivi des séances — Rebuild 2026

  if (!token) {
    return res.status(500).json({ error: "NOTION_TOKEN manquant" });
  }

  try {
    // Paginate pour récupérer toutes les entrées
    let allResults = [];
    let cursor = undefined;

    do {
      const body = cursor ? { start_cursor: cursor } : {};
      const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (req.query?.debug === "true") {
        return res.status(200).json(data);
      }

      if (!data.results) {
        return res.status(500).json({ error: "Réponse Notion invalide", detail: data });
      }

      allResults = allResults.concat(data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    // Parser chaque séance
    const seances = allResults.map((page) => {
      const p = page.properties;

      function get(name) {
        if (p[name]) return p[name];
        const n = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const key = Object.keys(p).find(k => n(k) === n(name));
        return key ? p[key] : undefined;
      }

      const dateRaw = get("Date")?.date?.start ?? null;
      const titre = get("Séance")?.title?.[0]?.plain_text ?? get("Seance")?.title?.[0]?.plain_text ?? "?";
      const type = get("Type")?.select?.name ?? null;
      const valide = page.properties?.[""]?.checkbox ?? false;
      const statut = get("Statut")?.select?.name ?? "À faire";
      const evaRaw = get("EVA ITBS")?.select?.name ?? "N/A";
      const cumulRaw = get("Cumul")?.rich_text?.[0]?.plain_text ?? null;

      // Parser les minutes depuis "14 min", "16 min", etc.
      const minutes = cumulRaw ? parseInt(cumulRaw.replace(/[^0-9]/g, ""), 10) || 0 : 0;

      // Parser EVA → number
      let eva = null;
      if (evaRaw === "0 OK") eva = 0;
      else if (evaRaw === "1-2 Gêne" || evaRaw === "1-2 Gene") eva = 1.5;
      else if (evaRaw === "3+ Stop") eva = 3;

      // Semaine ISO (lundi)
      let semaine = null;
      if (dateRaw) {
        const d = new Date(dateRaw);
        const day = d.getDay(); // 0=dim
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const lundi = new Date(d.setDate(diff));
        semaine = lundi.toISOString().split("T")[0];
      }

      return { titre, type, date: dateRaw, semaine, valide, statut, eva, minutes };
    });

    // Trier par date
    seances.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });

    // Grouper par semaine
    const semaines = {};
    for (const s of seances) {
      if (!s.semaine) continue;
      if (!semaines[s.semaine]) {
        semaines[s.semaine] = {
          debut: s.semaine,
          planifiees: 0,
          realisees: 0,
          course: 0,
          coursePlanifiees: 0,
          kb: 0,
          kine: 0,
          minutesCourse: 0,
          minutesPlan: 0,
          evaList: [],
        };
      }
      const w = semaines[s.semaine];
      w.planifiees++;
      if (s.valide) w.realisees++;
      if (s.type === "Course") {
        w.coursePlanifiees++;
        w.minutesPlan += s.minutes;
        if (s.valide) { w.course++; w.minutesCourse += s.minutes; }
      }
      if (s.type === "Kettlebell" && s.valide) w.kb++;
      if (s.type === "Kiné" && s.valide) w.kine++;
      if (s.eva !== null && s.valide) w.evaList.push(s.eva);
    }

    const semainesArr = Object.values(semaines).sort((a, b) => a.debut.localeCompare(b.debut));

    // Totaux globaux
    const totaux = {
      planifiees: seances.length,
      realisees: seances.filter(s => s.valide).length,
      minutesCourse: seances.filter(s => s.type === "Course" && s.valide).reduce((a, s) => a + s.minutes, 0),
      kbTotal: seances.filter(s => s.type === "Kettlebell" && s.valide).length,
      kineTotal: seances.filter(s => s.type === "Kiné" && s.valide).length,
      courseTotal: seances.filter(s => s.type === "Course" && s.valide).length,
    };

    res.status(200).json({ semaines: semainesArr, totaux, raw: seances });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
