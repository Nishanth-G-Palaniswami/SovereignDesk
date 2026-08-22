// Local embeddings via Ollama. No cloud: Voyage AI's managed embeddings are MongoDB-hosted
// and would break the zero-egress guarantee, so we generate on the box and store the vector.
import { EMBED_MODEL } from "./db.mjs";

const HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

export async function embed(inputs) {
  const one = !Array.isArray(inputs);
  const list = one ? [inputs] : inputs;
  const res = await fetch(`${HOST}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: list }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  if (!j.embeddings) throw new Error("no embeddings in response");
  return one ? j.embeddings[0] : j.embeddings;
}
