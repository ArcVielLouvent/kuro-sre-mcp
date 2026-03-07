import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@notionhq/client";
import "dotenv/config";

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;
const runbookId = process.env.NOTION_RUNBOOK_ID;

const server = new Server(
  {
    name: "KuroSRE-Enterprise-Cockpit",
    version: "2.0.0",
  },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_analyzing_tickets",
        description: "Mengambil daftar tiket error yang baru masuk (berada di kolom 'Analyzing') di Notion.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "search_kuro_runbook",
        description: "RAG: Mencari solusi resmi di database SOP/Runbook KuroTech berdasarkan kata kunci error (misal: 'fs' atau 'timeout'). SELALU gunakan tool ini sebelum membuat diagnosis akhir!",
        inputSchema: {
          type: "object",
          properties: { keyword: { type: "string" } },
          required: ["keyword"],
        },
      },
      {
        name: "submit_ai_diagnosis",
        description: "Mengirim hasil pemikiran AI kembali ke tiket Notion, lengkap dengan skor keyakinan dan deteksi kebocoran data (DLP).",
        inputSchema: {
          type: "object",
          properties: {
            pageId: { type: "string" },
            diagnosis: { type: "string", description: "Diagnosis teknis dan solusi" },
            severity: { type: "string", description: "Low, Medium, High, atau Critical" },
            confidenceScore: { type: "number", description: "Skor keyakinan AI dari 0 sampai 100" },
            isSecurityBreach: { type: "boolean", description: "True jika ada kebocoran password/API key di log" }
          },
          required: ["pageId", "diagnosis", "severity", "confidenceScore", "isSecurityBreach"],
        },
      },
      {
        name: "execute_approved_rollbacks",
        description: "Menjalankan webhook pemulihan server (rollback) HANYA untuk tiket yang telah disetujui (dicentang) oleh manusia di Notion.",
        inputSchema: { type: "object", properties: {} },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const dbInfo = await notion.databases.retrieve({ database_id: databaseId });
    const dataSourceId = dbInfo.data_sources[0].id;

    if (request.params.name === "get_analyzing_tickets") {
      const tickets = await notion.dataSources.query({
        data_source_id: dataSourceId,
        filter: { property: "Status", status: { equals: "Analyzing" } },
      });
      const extractedTickets = tickets.results.map((task) => ({
        id: task.id,
        title: task.properties.Name?.title?.[0]?.text?.content || "Unknown",
        errorLog: task.properties["Error Logs"]?.rich_text?.[0]?.text?.content || "No log",
      }));
      return { content: [{ type: "text", text: JSON.stringify(extractedTickets, null, 2) }] };
    }

    if (request.params.name === "search_kuro_runbook") {
      const { keyword } = request.params.arguments;
      const runbookInfo = await notion.databases.retrieve({ database_id: runbookId });
      
      const searchResults = await notion.dataSources.query({
        data_source_id: runbookInfo.data_sources[0].id,
        filter: { property: "Keywords", rich_text: { contains: keyword } }
      });

      const docs = searchResults.results.map(doc => ({
        title: doc.properties.Name?.title?.[0]?.text?.content,
        solution: doc.properties.Solution?.rich_text?.[0]?.text?.content
      }));

      return { 
        content: [{ type: "text", text: docs.length > 0 ? JSON.stringify(docs) : "Tidak ada SOP terkait di Runbook." }] 
      };
    }

    if (request.params.name === "submit_ai_diagnosis") {
      const { pageId, diagnosis, severity, confidenceScore, isSecurityBreach } = request.params.arguments;
      
      await notion.pages.update({
        page_id: pageId,
        properties: {
          "AI Diagnosis": { rich_text: [{ text: { content: diagnosis } }] },
          "Severity": { select: { name: severity } },
          "Confidence Score": { number: confidenceScore },
          "Security Breach": { checkbox: isSecurityBreach },
          "Status": { status: { name: "Open" } },
        },
      });
      return { content: [{ type: "text", text: `Sukses! Tiket ${pageId} diupdate dengan skor keyakinan ${confidenceScore}%.` }] };
    }

    if (request.params.name === "execute_approved_rollbacks") {
      const approvedTickets = await notion.dataSources.query({
        data_source_id: dataSourceId,
        filter: {
          and: [
            { property: "Approve Rollback", checkbox: { equals: true } },
            { property: "Status", status: { equals: "Open" } },
          ],
        },
      });

      let results = [];
      for (const task of approvedTickets.results) {
        const pageId = task.id;
        const webhook = await fetch("https://jsonplaceholder.typicode.com/posts", {
          method: "POST",
          body: JSON.stringify({ action: "rollback", target: pageId }),
        });

        if (webhook.ok) {
          await notion.pages.update({
            page_id: pageId,
            properties: {
              "Status": { status: { name: "Resolved" } },
              "Approve Rollback": { checkbox: false },
            },
          });
          results.push(`Rollback berhasil diluncurkan untuk tiket ID: ${pageId}`);
        }
      }
      return { content: [{ type: "text", text: results.length > 0 ? results.join("\n") : "Tidak ada tiket yang disetujui." }] };
    }

    throw new Error("Tool tidak valid");
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Error KuroSRE: ${error.message}` }] };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 KuroSRE Enterprise MCP Server berjalan pada protokol stdio.");
}

main().catch(console.error);