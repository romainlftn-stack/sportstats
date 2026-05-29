export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.NOTION_TOKEN;
  const dbId = "a4f674b8d9274089a8096f4c26e42522";

  if (!token) return res.status(500).json({ error: "NOTION_TOKEN manquant" });

  const { days } = req.body;
  if (!days || isNaN(days) || days < 1 || days > 30) {
    return res.status(400).json({ error: "Nombre de jours invalide (1-30)" });
  }

  const today = new Date().toISOString().split("T")[0];

  try {
    // 1. Récupérer toutes les séances À faire avec date >= aujourd'hui
    let allResults = [];
    let cursor = undefined;

    do {
      const body = {
        filter: {
          and: [
            { property: "Statut", select: { equals: "À faire" } },
            { property: "Date", date: { on_or_after: today } }
          ]
        },
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
      if (!data.results) return res.status(500).json({ error: "Réponse Notion invalide", detail: data });

      allResults = allResults.concat(data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    if (allResults.length === 0) {
      return res.status(200).json({ updated: 0, message: "Aucune séance à décaler" });
    }

    // 2. Décaler chaque séance de N jours
    const updates = allResults.map(async (page) => {
      const currentDate = page.properties?.Date?.date?.start;
      if (!currentDate) return null;

      const d = new Date(currentDate);
      d.setDate(d.getDate() + parseInt(days));
      const newDate = d.toISOString().split("T")[0];

      const response = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            Date: { date: { start: newDate } }
          }
        }),
      });

      return response.ok ? page.id : null;
    });

    const results = await Promise.all(updates);
    const updated = results.filter(Boolean).length;

    return res.status(200).json({
      updated,
      days: parseInt(days),
      message: `${updated} séances décalées de ${days} jour${days > 1 ? "s" : ""}`
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
