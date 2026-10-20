// The scene's own copy of a town from a 'load'. The HUD and the scene each push
// a new tube or decoration into their own arrays, so sharing an array stored it
// twice. Rows stay shared: a drag updates position_x/position_y in place for both.
export function sceneTownData(data) {
  return {
    stations: [...(data.stations || [])],
    decorations: [...(data.decorations || [])],
    connections: [...(data.connections || [])],
  };
}
