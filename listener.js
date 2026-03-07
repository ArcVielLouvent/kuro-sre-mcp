import { Client } from "@notionhq/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const databaseId = process.env.NOTION_DATABASE_ID;

console.log("🎧 [KUROTECH CORE] Radar SRE Aktif. Memantau pergerakan tiket...\n");

async function processNotionQueue() {
  try {
    const dbInfo = await notion.databases.retrieve({ database_id: databaseId });
    const dataSourceId = dbInfo.data_sources[0].id;

    const ticketsToAnalyze = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: { property: "Status", status: { equals: "Analyzing" } },
    });

    for (const task of ticketsToAnalyze.results) {
      console.log(`\n🧠 [AI WORKER] Menemukan tiket mentah. Meminta Gemini menganalisis...`);
      const pageId = task.id;
      const errorLog = task.properties["Error Logs"]?.rich_text[0]?.text?.content || "No log provided.";

      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const prompt = `Sebagai Senior DevOps, analisis log error ini:
      "${errorLog}"
      
      Berikan respons HANYA dalam format JSON dengan struktur ini:
      {
        "diagnosis": "Penjelasan singkat maks 3 kalimat dan solusinya",
        "severity": "Pilih satu: Low, Medium, atau Critical"
      }`;

      const result = await model.generateContent(prompt);
      let aiResponseText = result.response.text();
      
      aiResponseText = aiResponseText.replace(/```json/g, "").replace(/```/g, "").trim();
      
      const aiData = JSON.parse(aiResponseText);
      const aiDiagnosis = aiData.diagnosis;
      const aiSeverity = aiData.severity;

      console.log(`💡 [AI] Diagnosis: ${aiDiagnosis}`);
      console.log(`🚦 [AI] Severity: ${aiSeverity}`);

      await notion.pages.update({
        page_id: pageId,
        properties: {
          "AI Diagnosis": { rich_text: [{ text: { content: aiDiagnosis } }] },
          "Severity": { select: { name: aiSeverity } },
          "Status": { status: { name: "Open" } }
        }
      });
      console.log(`✅ [AI WORKER] Analisis selesai. Tiket dipindahkan ke 'Open'.`);
    }

    const ticketsToRollback = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        and: [
          { property: "Approve Rollback", checkbox: { equals: true } },
          { property: "Status", status: { equals: "Open" } },
        ],
      },
    });

    for (const task of ticketsToRollback.results) {
      console.log(`\n🚀 [WEBHOOK WORKER] Perintah Rollback Diterima!`);
      const pageId = task.id;

      const triggerRollback = await fetch("https://jsonplaceholder.typicode.com/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rollback", incident_id: pageId })
      });

      if (triggerRollback.ok) {
        console.log(`✅ [WEBHOOK] Berhasil menembak server CI/CD (Status: 201)`);
      }

      await notion.pages.update({
        page_id: pageId,
        properties: {
          "Status": { status: { name: "Resolved" } },
          "Approve Rollback": { checkbox: false }
        }
      });
      console.log(`✅ [WEBHOOK WORKER] Insiden ditutup. Tiket dipindahkan ke 'Resolved'.`);
    }

  } catch (error) {
    console.error("❌ Terjadi kesalahan sistem:", error.message);
  }
}

setInterval(processNotionQueue, 5000);