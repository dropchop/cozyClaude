// Seeds an example "Blog Post Factory" pipeline so the UI has something to show
// on first run. Idempotent-ish: creates a fresh pipeline each time it runs.
//   node src/seed.mjs
import { initDb, query, one } from './db.js';

async function main() {
  await initDb();

  const p = await one(
    `INSERT INTO pipelines (name, description) VALUES ($1, $2) RETURNING *`,
    ['Writers’ Row', 'A cozy neighborhood: Research → Outline → Draft → Edit']
  );

  const station = (name, prompt, style, x, y) => one(
    `INSERT INTO stations (pipeline_id, name, system_prompt, style, position_x, position_y)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [p.id, name, prompt, style, x, y]
  );

  const researcher = await station('Researcher',
    'You are a research agent. Given a topic, list 5 key facts and angles worth covering. Be concise.', 'cottage', 60, 160);
  const outliner = await station('Outliner',
    'You are an outlining agent. Turn the research notes into a clear blog post outline with sections.', 'shop', 360, 160);
  const writer = await station('Writer',
    'You are a writing agent. Write an engaging blog post following the outline. Use a warm, clear voice.', 'bakery', 660, 160);
  const editor = await station('Editor',
    'You are an editor. Tighten the draft, fix awkward phrasing, and return the final polished post.', 'tower', 960, 160);

  const connect = (a, b) => query(
    `INSERT INTO connections (pipeline_id, from_station_id, to_station_id) VALUES ($1, $2, $3)`,
    [p.id, a.id, b.id]
  );
  await connect(researcher, outliner);
  await connect(outliner, writer);
  await connect(writer, editor);

  // A few starter decorations so the meadow isn't bare.
  const decor = (kind, x, y) => query(
    `INSERT INTO decorations (pipeline_id, kind, position_x, position_y) VALUES ($1, $2, $3, $4)`,
    [p.id, kind, x, y]
  );
  await decor('tree', 180, 40);
  await decor('tree', 540, 30);
  await decor('pine', 900, 36);
  await decor('fountain', 470, 380);
  await decor('flower', 260, 360);
  await decor('flower', 700, 370);
  await decor('bush', 120, 400);
  await decor('lamp', 380, 360);
  for (let i = 0; i < 8; i++) await decor('path', 220 + i * 32, 300);

  console.log(`Seeded neighborhood "${p.name}" (${p.id}) with 4 houses + decorations.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
