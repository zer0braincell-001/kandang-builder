// Satu-satunya sumber konversi koordinat kubus/panel <-> dunia/key.
// Sel grid (x,y,z) menempati ruang [x,x+1]x[y,y+1]x[z,z+1];
// pusat mesh-nya di +0.5 tiap sumbu. Jangan hardcode offset
// posisi atau format key di tempat lain.

export type Dir = '+x' | '-x' | '+y' | '-y' | '+z' | '-z'

export const FACE_DIRS: Record<Dir, readonly [number, number, number]> = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
}

export const DIRS = Object.keys(FACE_DIRS) as Dir[]

export function oppositeDir(dir: Dir): Dir {
  return ((dir[0] === '+' ? '-' : '+') + dir[1]) as Dir
}

export function cubeToWorld(x: number, y: number, z: number): [number, number, number] {
  return [x + 0.5, y + 0.5, z + 0.5];
}

export function cubeKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function parseCubeKey(key: string): [number, number, number] {
  const [x, y, z] = key.split(',').map(Number);
  return [x, y, z];
}

export function panelKey(x: number, y: number, z: number, dir: Dir): string {
  return `${x},${y},${z},${dir}`;
}

export function parsePanelKey(key: string): [number, number, number, Dir] {
  const parts = key.split(',');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2]), parts[3] as Dir];
}

// Pusat sisi (x,y,z,dir) = titik tengah antara pusat kubus itu dan
// pusat sel tetangganya — offset +0.5 sepanjang normal, diturunkan
// dari cubeToWorld alih-alih di-hardcode.
export function panelToWorld(x: number, y: number, z: number, dir: Dir): [number, number, number] {
  const [dx, dy, dz] = FACE_DIRS[dir];
  const a = cubeToWorld(x, y, z);
  const b = cubeToWorld(x + dx, y + dy, z + dz);
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}
