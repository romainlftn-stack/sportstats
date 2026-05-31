export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.NOTION_TOKEN;
  const dbId = "a4f674b8d9274089a8096f4c26e42522";
  if (!token) return res.status(500).json({ error: "NOTION_TOKEN manquant" });

  const { days = 0, includeMissed = false, missedIndices = null, fromIdx = null } = req.body;
  if (isNaN(days) || days < 0 || days > 30) {
    return res.status(400).json({ error: "Nombre de jours invalide (0-30)" });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  try {
    // Récupérer toutes les séances "À faire"
    let allResults = [];
    let cursor = undefined;
    do {
      const body = {
        filter: { property: "Statut", select: { equals: "À faire" } },
        sorts: [{ property: "Date", direction: "ascending" }],
        ...(cursor ? { start_cursor: cursor } : {})
      };
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
      if (!data.results) return res.status(500).json({ error: "Réponse Notion invalide" });
      allResults = allResults.concat(data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    if (allResults.length === 0) {
      return res.status(200).json({ updated: 0, message: "Aucune séance à reporter" });
    }

    let sessionsToShift;
    let offsetDays;

    if (includeMissed) {
      const allSessions = allResults.filter(p => p.properties?.Date?.date?.start);
      const missed = allSessions.filter(p => p.properties.Date.date.start < todayStr);

      // Determine which missed sessions to include
      let includedMissed;
      if (Array.isArray(missedIndices) && missedIndices.length > 0) {
        includedMissed = missedIndices
          .map(i => missed[i])
          .filter(Boolean)
          .sort((a, b) => a.properties.Date.date.start.localeCompare(b.properties.Date.date.start));
      } else if (fromIdx !== null && missed[fromIdx]) {
        includedMissed = missed.slice(fromIdx);
      } else {
        includedMissed = missed;
      }

      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + parseInt(days));

      if (includedMissed.length === 0) {
        sessionsToShift = allSessions.filter(p => p.properties.Date.date.start >= todayStr);
        offsetDays = parseInt(days);
      } else {
        const startDate = new Date(includedMissed[0].properties.Date.date.start);
        startDate.setHours(0, 0, 0, 0);
        offsetDays = Math.round((targetDate - startDate) / (1000 * 60 * 60 * 24));
        const includedIds = new Set(includedMissed.map(p => p.id));
        sessionsToShift = allSessions.filter(p => {
          const d = p.properties.Date.date.start;
          return includedIds.has(p.id) || d >= todayStr;
        });
      }
    } else {
      // Uniquement les séances futures
      sessionsToShift = allResults.filter(p => {
        const d = p.properties?.Date?.date?.start;
        return d && d >= todayStr;
      });
      offsetDays = parseInt(days);
    }

    if (sessionsToShift.length === 0 || offsetDays === 0) {
      return res.status(200).json({ updated: 0, message: "Aucun décalage nécessaire" });
    }

    // Appliquer l'offset à chaque séance
    const updates = sessionsToShift.map(async (page) => {
      const currentDate = page.properties.Date.date.start;
      const d = new Date(currentDate);
      d.setDate(d.getDate() + offsetDays);
      const newDate = d.toISOString().split("T")[0];

      const response = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: { Date: { date: { start: newDate } } }
        }),
      });
      return response.ok ? page.id : null;
    });

    const results = await Promise.all(updates);
    const updated = results.filter(Boolean).length;

    return res.status(200).json({
      updated,
      offsetDays,
      message: `${updated} séances reportées de ${offsetDays} jour${Math.abs(offsetDays) > 1 ? "s" : ""}`
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
