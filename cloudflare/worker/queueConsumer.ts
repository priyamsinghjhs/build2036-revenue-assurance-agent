/** Cloudflare Queue consumer skeleton for heavy recon (free tier). */

export interface ReconJob {
  type: "recon" | "retention" | "ingest";
  domain?: string;
  file_id?: string;
  run_id?: string;
}

export async function handleQueue(batch: { messages: Array<{ body: ReconJob }> }) {
  for (const msg of batch.messages) {
    const job = msg.body;
    // In production: process chunk, write results, ack
    console.log("queue_job", job.type, job.domain || job.file_id);
  }
}

// Bind in wrangler:
// "queues": { "consumers": [{ "queue": "recon-jobs", "max_batch_size": 10 }] }
