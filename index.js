import { Client } from "@notionhq/client";
import "dotenv/config";

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

async function simulateVercelError() {
  console.log("🚨 [VERCEL SENSOR] Mendeteksi error build dari server...");
  const errorTitle = "Vercel Build Failed: Missing Module";
  const errorLog = "Error: Module not found: Can't resolve 'fs' in '/vercel/path0/components/Navbar.jsx'. Build failed.";

  try {
    await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        "Name": { title: [{ text: { content: errorTitle } }] },
        "Status": { status: { name: "Analyzing" } },
        "Error Logs": { rich_text: [{ text: { content: errorLog } }] }
      },
    });
    console.log("✅ [VERCEL SENSOR] Log mentah terkirim ke Notion (Status: Analyzing).");
  } catch (error) {
    console.error("❌ Gagal mengirim log:", error.message);
  }
}

simulateVercelError();