import * as THREE from 'three';
import { CellType } from './CellType.js';
import { NEIGHBORS } from './Grid.js';
import { legacyIntensity, pointIntensity, POINT_DECAY } from '../render/lights.js';

/**
 * Builds the static scene for a level: lighting, floor, instanced walls with
 * neon edge strips, pillars, the hologram landmark and the starfield.
 * Returns an object with an `update(dt)` for the few animated props.
 */
export function buildWorld({ scene, grid, assets }) {
  addLights(scene);
  addFloor(scene, grid, assets.tex);
  addWalls(scene, grid, assets.tex);
  const pillarCentre = addPillars(scene, grid);
  addStars(scene);
  const holo = pillarCentre ? addHologram(scene, pillarCentre) : null;

  return {
    update(dt) {
      if (!holo) return;
      holo.group.rotation.y += dt * 0.8;
      holo.outer.rotation.x += dt * 0.5;
      holo.inner.rotation.z += dt * 1.2;
    },
  };
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0x4a7cff, 0x220833, legacyIntensity(0.85)));
  scene.add(new THREE.AmbientLight(0xffffff, legacyIntensity(0.12)));
  const sun = new THREE.DirectionalLight(0xa8e8ff, legacyIntensity(0.65));
  sun.position.set(30, 60, 20);
  scene.add(sun);
}

function addFloor(scene, grid, tex) {
  const w = grid.cols * grid.cell + 60;
  const d = grid.rows * grid.cell + 60;
  for (const t of [tex.floorMap, tex.floorEmissive]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w / 6, d / 6);
  }
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({
      map: tex.floorMap,
      emissiveMap: tex.floorEmissive,
      emissive: 0xffffff,
      emissiveIntensity: 0.55,
      roughness: 0.5,
      metalness: 0.3,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
}

function addWalls(scene, grid, tex) {
  const walls = [];
  const strips = [];
  grid.forEachCell((c, r, t) => {
    if (t !== CellType.WALL) return;
    walls.push([grid.cellX(c), grid.cellZ(r)]);
    // Neon strips only on faces that look into a corridor.
    for (const [dc, dr] of NEIGHBORS) {
      if (!grid.inBounds(c + dc, r + dr) || grid.type(c + dc, r + dr) === CellType.WALL) continue;
      strips.push([grid.cellX(c), grid.cellZ(r), dc, dr]);
    }
  });

  const dummy = new THREE.Object3D();
  const wallMat = new THREE.MeshStandardMaterial({
    map: tex.wallMap,
    emissiveMap: tex.wallEmissive,
    emissive: 0xffffff,
    emissiveIntensity: 1,
    roughness: 0.45,
    metalness: 0.45,
  });
  const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(grid.cell, grid.wallHeight, grid.cell), wallMat, walls.length);
  walls.forEach(([x, z], i) => {
    dummy.position.set(x, grid.wallHeight / 2, z);
    dummy.updateMatrix();
    wallMesh.setMatrixAt(i, dummy.matrix);
  });
  scene.add(wallMesh);

  const stripGeo = new THREE.BoxGeometry(1, 1, 1);
  const top = new THREE.InstancedMesh(stripGeo, new THREE.MeshBasicMaterial({ color: 0x00f3ff }), strips.length);
  const bottom = new THREE.InstancedMesh(stripGeo, new THREE.MeshBasicMaterial({ color: 0xff0055 }), strips.length);
  const off = grid.cell / 2 + 0.04;
  strips.forEach(([x, z, dc, dr], i) => {
    const px = x + dc * off;
    const pz = z + dr * off;
    const sx = dc !== 0 ? 0.12 : grid.cell;
    const sz = dr !== 0 ? 0.12 : grid.cell;
    dummy.position.set(px, grid.wallHeight - 0.08, pz);
    dummy.scale.set(sx, 0.14, sz);
    dummy.updateMatrix();
    top.setMatrixAt(i, dummy.matrix);
    dummy.position.set(px, 0.12, pz);
    dummy.scale.set(sx, 0.07, sz);
    dummy.updateMatrix();
    bottom.setMatrixAt(i, dummy.matrix);
  });
  scene.add(top, bottom);
}

/** Returns the centre of all pillar cells (used to place the hologram), or null. */
function addPillars(scene, grid) {
  const size = grid.pillarHalf * 2;
  const h = grid.pillarHeight;
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x23274a, roughness: 0.25, metalness: 0.8, emissive: 0x0a0418 });
  const bandMat = new THREE.MeshBasicMaterial({ color: 0x9b30ff });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xc77dff });
  const pGeo = new THREE.BoxGeometry(size, h, size);
  const pEdges = new THREE.EdgesGeometry(pGeo);
  const bandGeo = new THREE.BoxGeometry(size + 0.1, 0.16, size + 0.1);
  let sx = 0;
  let sz = 0;
  let n = 0;
  grid.forEachCell((c, r, t) => {
    if (t !== CellType.PILLAR) return;
    const g = new THREE.Group();
    g.position.set(grid.cellX(c), 0, grid.cellZ(r));
    const m = new THREE.Mesh(pGeo, pillarMat);
    m.position.y = h / 2;
    const e = new THREE.LineSegments(pEdges, edgeMat);
    e.position.y = h / 2;
    g.add(m, e);
    for (const y of [1.2, 4.2, h - 0.1]) {
      const b = new THREE.Mesh(bandGeo, bandMat);
      b.position.y = y;
      g.add(b);
    }
    scene.add(g);
    sx += g.position.x;
    sz += g.position.z;
    n++;
  });
  return n ? { x: sx / n, z: sz / n, top: h } : null;
}

function addHologram(scene, centre) {
  const group = new THREE.Group();
  group.position.set(centre.x, centre.top + 4.8, centre.z);
  const inner = new THREE.Mesh(new THREE.OctahedronGeometry(2.2, 0), new THREE.MeshBasicMaterial({ color: 0x9b30ff, wireframe: true }));
  const outer = new THREE.Mesh(
    new THREE.IcosahedronGeometry(3.4, 0),
    new THREE.MeshBasicMaterial({ color: 0x00f3ff, wireframe: true, transparent: true, opacity: 0.45 }),
  );
  group.add(inner, outer);
  scene.add(group);

  const light = new THREE.PointLight(0x9b30ff, pointIntensity(2.4), 70, POINT_DECAY);
  light.position.set(centre.x, centre.top + 2.3, centre.z);
  scene.add(light);
  return { group, inner, outer };
}

function addStars(scene) {
  const count = 1400;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 0.9 + 0.08;
    const th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = Math.cos(th) * s * 380;
    pos[i * 3 + 1] = u * 380;
    pos[i * 3 + 2] = Math.sin(th) * s * 380;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9fd8ff, size: 1.6, sizeAttenuation: false, fog: false })));
}
