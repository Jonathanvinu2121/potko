// Names and icons for the kinds of dining areas and tables, used by the set-up screens.
export const AREA_KINDS = [
  { value: 'indoor', label: 'Indoor', icon: 'home-outline' },
  { value: 'outdoor', label: 'Outdoor', icon: 'pine-tree' },
  { value: 'private', label: 'Private', icon: 'crown-outline' },
  { value: 'bar', label: 'Bar', icon: 'glass-cocktail' },
  { value: 'custom', label: 'Custom', icon: 'shape-outline' },
];
export const areaKind = (value) => AREA_KINDS.find((k) => k.value === value) ?? AREA_KINDS[0];

export const TABLE_KINDS = [
  { value: 'normal', label: 'Normal', icon: 'table-furniture' },
  { value: 'vip', label: 'VIP', icon: 'crown-outline' },
  { value: 'booth', label: 'Booth', icon: 'sofa-outline' },
  { value: 'outdoor', label: 'Outdoor', icon: 'pine-tree' },
  { value: 'custom', label: 'Custom', icon: 'shape-outline' },
];
export const tableKind = (value) => TABLE_KINDS.find((k) => k.value === value) ?? TABLE_KINDS[0];

export const TABLE_SHAPES = [
  { value: 'square', label: 'Square', icon: 'square-outline' },
  { value: 'round', label: 'Round', icon: 'circle-outline' },
  { value: 'rectangle', label: 'Rectangle', icon: 'rectangle-outline' },
  { value: 'booth', label: 'Booth', icon: 'sofa-single-outline' },
];
export const TABLE_SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];
