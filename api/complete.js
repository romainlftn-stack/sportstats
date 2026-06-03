export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.NOTION_TOKEN;
  const dbId = "a4f674b8d9274089a8096f4c26e42522";
  if (!token) return res.status(500).json({ error: "NOTION_TOKEN manquant" });

  const { title, date } = req.body;
  if (!date) return res.status(400).json({ error: "date manquante" });

  try {
    // Trouver la page par date
    const queryRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: {
          and: [
            { property: "Date", date: { equals: date } },
            { property: "Statut", select: { equals: "À faire" } },
          ],
        },
      }),
    });

    const data = await queryRes.json();
    if (!data.results?.length) {
      return res.status(404).json({ error: "Séance introuvable ou déjà réalisée" });
    }

    // Si plusieurs résultats le même jour, prendre celui dont le titre correspond
    let page = data.results[0];
    if (title && data.results.length > 1) {
      const match = data.results.find(p => {
        const t = p.properties?.["Séance"]?.title?.[0]?.plain_text ?? "";
        return t === title;
      });
      if (match) page = match;
    }

    // Marquer comme Réalisé
    const patchRes = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          Statut: { select: { name: "Réalisé" } },
        },
      }),
    });

    if (!patchRes.ok) {
      const err = await patchRes.json();
      return res.status(500).json({ error: err.message ?? "Erreur Notion" });
    }

    return res.status(200).json({ ok: true, id: page.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
