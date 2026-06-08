import { memo } from 'react';

// A tiny 12x16 pixel-art townsperson drawn with crisp SVG rects.
// `color` = shirt, `hair` = hair color. Legs animate for a choppy walk cycle.
function VillagerImpl({ color = '#d23c3c', hair = '#5a3a1c' }) {
  const skin = '#f0c090';
  const pants = '#39406a';
  const dark = '#241a12';
  return (
    <svg className="villager" viewBox="0 0 12 16" width="24" height="32" shapeRendering="crispEdges">
      {/* hair */}
      <rect x="3" y="1" width="6" height="2" fill={hair} />
      <rect x="2" y="2" width="1" height="2" fill={hair} />
      <rect x="9" y="2" width="1" height="2" fill={hair} />
      {/* face */}
      <rect x="3" y="3" width="6" height="3" fill={skin} />
      {/* eyes */}
      <rect x="4" y="4" width="1" height="1" fill={dark} />
      <rect x="7" y="4" width="1" height="1" fill={dark} />
      {/* body / shirt */}
      <rect x="2" y="6" width="8" height="5" fill={color} />
      {/* arms */}
      <rect x="1" y="6" width="1" height="4" fill={skin} />
      <rect x="10" y="6" width="1" height="4" fill={skin} />
      {/* belt */}
      <rect x="2" y="10" width="8" height="1" fill={dark} />
      {/* legs (animated) */}
      <rect className="villager__leg villager__leg--l" x="3" y="11" width="2" height="4" fill={pants} />
      <rect className="villager__leg villager__leg--r" x="7" y="11" width="2" height="4" fill={pants} />
      {/* feet */}
      <rect x="3" y="15" width="2" height="1" fill={dark} />
      <rect x="7" y="15" width="2" height="1" fill={dark} />
    </svg>
  );
}

export const Villager = memo(VillagerImpl);
