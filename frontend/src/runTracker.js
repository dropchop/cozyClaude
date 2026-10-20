// Whether the town on screen has a run in progress. It follows the server, not
// the clicks: on a town switch it reads that town's latest run, then it follows
// that town's run_update events. So a run that ends while another town is shown
// can't leave the button stuck, and a run already going (mail, reload) shows busy.
export function createRunTracker({ listRuns, onBusy }) {
  let shown = null;
  let seq = 0; // bumped by every switch and live event; a stale list reply is dropped
  return {
    async show(pipelineId) {
      shown = pipelineId;
      const mine = ++seq;
      onBusy(false);
      if (!pipelineId) return;
      const runs = await listRuns(pipelineId); // newest first
      if (mine === seq) onBusy(runs?.[0]?.status === 'running');
    },
    event({ event, data }) {
      if (event !== 'run_update' || !data || data.pipeline_id !== shown) return;
      seq++;
      onBusy(data.status === 'running');
    },
  };
}
