import * as THREE from 'three';

/**
 * Builds the articulated robot mesh for an enemy type. Faces +Z.
 * Limb groups pivot at hips / shoulders so walk cycles look natural.
 */
export function buildEnemyModel(assets, type) {
  const { geo, mat } = assets;
  const palette = assets.palettes[type.palette];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const flashables = [];

  const part = (parent, g, m, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    if (m === palette.body) flashables.push(mesh);
    return mesh;
  };
  const pivot = (parent, x, y, z) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  part(body, geo.pelvis, palette.body, 0, 0.85, 0);
  part(body, geo.torso, palette.body, 0, 1.25, 0);
  part(body, geo.head, palette.body, 0, 1.92, 0);
  part(body, geo.visor, palette.visor, 0, 1.95, 0.22);
  part(body, geo.core, palette.visor, 0, 1.32, 0.215);
  part(body, geo.shoulder, palette.body, -0.47, 1.58, 0);
  part(body, geo.shoulder, palette.body, 0.47, 1.58, 0);

  const armL = pivot(body, -0.47, 1.55, 0);
  part(armL, geo.arm, palette.body);
  const armR = pivot(body, 0.47, 1.55, 0);
  part(armR, geo.arm, palette.body);

  // Gun runs along the arm; its tip glows during the firing wind-up.
  const gun = part(armR, geo.gun, mat.gun, 0, -0.68, 0.06);
  gun.rotation.x = Math.PI / 2;
  const tip = part(gun, geo.tip, mat.tip, 0, 0, 0.3);

  const legL = pivot(root, -0.17, 0.82, 0);
  part(legL, geo.leg, palette.body);
  const legR = pivot(root, 0.17, 0.82, 0);
  part(legR, geo.leg, palette.body);

  const beacon = new THREE.Sprite(mat.alert);
  beacon.position.set(0, 2.65, 0);
  beacon.scale.set(0.7, 0.7, 0.7);
  beacon.visible = false;
  root.add(beacon);

  // Laser sight shown while winding up a shot (world-space, not parented).
  const aim = new THREE.Mesh(geo.unitCylinder, mat.aim);
  aim.visible = false;
  aim.frustumCulled = false;

  return { root, body, armL, armR, legL, legR, tip, beacon, aim, flashables, palette };
}
