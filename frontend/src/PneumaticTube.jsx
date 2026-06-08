import { getSmoothStepPath } from '@xyflow/react';

// A custom edge drawn as an old-school pneumatic bank tube: dark casing, a
// translucent glass core, brass bands, and a highlight. While the neighborhood
// is running (data.active), a brass carrier capsule zips along the tube.
export function PneumaticTube({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data,
}) {
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 18,
  });
  const active = !!data?.active;

  return (
    <g className={`tube ${active ? 'tube--active' : ''}`}>
      {/* fat invisible path = easy click target for selecting/deleting */}
      <path className="react-flow__edge-interaction" d={edgePath} fill="none" stroke="transparent" strokeWidth={22} />

      <path className="tube__casing" d={edgePath} />
      <path className="tube__glass" d={edgePath} />
      <path className="tube__bands" d={edgePath} />
      <path className="tube__shine" d={edgePath} />

      {/* fittings at each end */}
      <circle className="tube__fitting" cx={sourceX} cy={sourceY} r={6} />
      <circle className="tube__fitting" cx={targetX} cy={targetY} r={6} />

      {active && (
        <g className="tube__carrier">
          <rect x={-8} y={-4.5} width={16} height={9} rx={3} className="tube__carrier-body" />
          <rect x={-8} y={-4.5} width={3} height={9} className="tube__carrier-cap" />
          <rect x={5} y={-4.5} width={3} height={9} className="tube__carrier-cap" />
          <animateMotion dur="1.05s" repeatCount="indefinite" path={edgePath} rotate="auto" />
        </g>
      )}
    </g>
  );
}
