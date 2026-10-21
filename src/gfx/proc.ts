import {
  Color,
  MeshDepthMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
  Texture,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
  type MeshPhysicalMaterialParameters,
  type MeshStandardMaterialParameters,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { BUMP, NOISE } from './glsl'

// 程序化材质：在 three 自带的 PBR 材质上插几段着色器，颜色、粗糙度、凹凸都按物体坐标现算。
// 这样光照、阴影、环境反射照常，纹理不用任何图片。
//
// 片元里能用的变量：
//   vPos  物体坐标（厘米）  vNrm  物体法线  vWPos  世界坐标
//   diffuseColor（改它就是改颜色）、procBump（写高度，厘米）、roughnessFactor、metalnessFactor
//   material（物理材质的结构体，在 physical 段里改清漆、绒光等）

export interface ProcOpts {
  uniforms?: Record<string, IUniform>
  /** 额外的 attribute / varying 声明（顶点和片元都会带上 varying） */
  attributes?: string
  varyings?: string
  vertexHead?: string
  /** begin_vertex 之后，可改 transformed、写 varying */
  vertex?: string
  fragmentHead?: string
  color?: string
  rough?: string
  metal?: string
  /** 有凹凸就设 true，procBump 会被用来扰动法线 */
  bump?: boolean
  emissive?: string
  physical?: string
  /** 镂空：写 discard 的代码，阴影也跟着镂空 */
  discard?: string
}

function glslType(v: unknown): string {
  if (typeof v === 'number') return 'float'
  if (typeof v === 'boolean') return 'bool'
  if (v instanceof Color) return 'vec3'
  if (v instanceof Vector2) return 'vec2'
  if (v instanceof Vector3) return 'vec3'
  if (v instanceof Vector4) return 'vec4'
  if (v instanceof Texture) return 'sampler2D'
  throw new Error('unknown uniform type')
}

function uniformDecls(u: Record<string, IUniform> | undefined) {
  if (!u) return ''
  return Object.entries(u)
    .map(([k, { value }]) => {
      if (value instanceof Float32Array || Array.isArray(value)) {
        const t = value.length && typeof value[0] !== 'number' ? glslType(value[0]) : 'float'
        return `uniform ${t} ${k}[${value.length}];`
      }
      return `uniform ${glslType(value)} ${k};`
    })
    .join('\n')
}

let keySeq = 0
const keyOf = new Map<string, string>()
function cacheKey(src: string) {
  let k = keyOf.get(src)
  if (!k) keyOf.set(src, (k = 'proc' + keySeq++))
  return k
}

function patchVertex(vs: string, o: ProcOpts) {
  return vs
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vWPos;
varying vec3 vWNrm;
${o.attributes ?? ''}
${o.varyings ?? ''}
${uniformDecls(o.uniforms)}
${NOISE}
${o.vertexHead ?? ''}`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vPos = position;
vNrm = normal;
{
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
    wn = mat3(instanceMatrix) * wn;
  #endif
  vWNrm = normalize(mat3(modelMatrix) * wn);
}
${o.vertex ?? ''}`,
    )
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
{
  vec4 wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  vWPos = (modelMatrix * wp).xyz;
}`,
    )
}

function patchFragment(fs: string, o: ProcOpts) {
  return fs
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vWPos;
varying vec3 vWNrm;
${o.varyings ?? ''}
${uniformDecls(o.uniforms)}
${NOISE}
${BUMP}
${o.fragmentHead ?? ''}`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
float procBump = 0.0;
${o.discard ?? ''}
${o.color ?? ''}`,
    )
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${o.rough ?? ''}`)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${o.metal ?? ''}`)
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
${o.bump ? 'normal = procPerturb(-vViewPosition, normal, procBump, faceDirection);' : ''}`,
    )
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${o.emissive ?? ''}`)
    .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${o.physical ?? ''}`)
}

function apply<M extends MeshStandardMaterial>(mat: M, o: ProcOpts): M {
  const src = JSON.stringify(o, (k, v) => (k === 'uniforms' ? Object.keys(v ?? {}) : v)) + mat.type
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, o.uniforms ?? {})
    shader.vertexShader = patchVertex(shader.vertexShader, o)
    shader.fragmentShader = patchFragment(shader.fragmentShader, o)
  }
  mat.customProgramCacheKey = () => cacheKey(src)
  mat.userData.proc = o
  return mat
}

export function procStandard(params: MeshStandardMaterialParameters, o: ProcOpts) {
  return apply(new MeshStandardMaterial(params), o)
}

export function procPhysical(params: MeshPhysicalMaterialParameters, o: ProcOpts) {
  return apply(new MeshPhysicalMaterial(params), o)
}

/** 顶点动了（风吹）或者有镂空的物体，阴影要用同一段代码，不然影子对不上 */
export function procDepth(o: ProcOpts) {
  const mat = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  const src = 'depth' + JSON.stringify({ a: o.attributes, v: o.vertex, d: o.discard, vh: o.vertexHead, fh: o.fragmentHead })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, o.uniforms ?? {})
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vWPos;
${o.attributes ?? ''}
${o.varyings ?? ''}
${uniformDecls(o.uniforms)}
${NOISE}
${o.vertexHead ?? ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vPos = position;
vNrm = normal;
vWPos = vec3(0.0);
${o.vertex ?? ''}`,
      )
    if (o.discard) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vWPos;
${o.varyings ?? ''}
${uniformDecls(o.uniforms)}
${NOISE}
${o.fragmentHead ?? ''}`,
        )
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${o.discard}`)
    }
  }
  mat.customProgramCacheKey = () => cacheKey(src)
  return mat
}
