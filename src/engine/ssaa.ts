/* Supersampling for still frames: the frame drawn at 2× or 3× and each block averaged back into one pixel (an exact box
   filter, on the GPU through WebGL, on the CPU without it). It smooths what the canvas cannot: thin lines, fine grain,
   words shrunk far down in the ending overview. */
const S: {
  gl: WebGLRenderingContext | null;
  cv: HTMLCanvasElement | null;
  R: WebGLUniformLocation | null;
  N: WebGLUniformLocation | null;
  ok: boolean;
} = { gl: null, cv: null, R: null, N: null, ok: true };
const FS = `precision highp float; uniform sampler2D T; uniform vec2 R; uniform float N;
void main(){ vec2 b=(gl_FragCoord.xy-0.5)*N; vec3 s=vec3(0.);
  for(int i=0;i<3;i++) for(int j=0;j<3;j++){ if(float(i)<N&&float(j)<N) s+=texture2D(T,(b+vec2(float(i),float(j))+0.5)*R).rgb; }
  gl_FragColor=vec4(s/(N*N),1.); }`;
function setup(): boolean {
  const cv = document.createElement('canvas'),
    gl = cv.getContext('webgl', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
      alpha: false,
    });
  if (!gl) return false;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position=vec4(p,0.,1.); }'),
    fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return false;
  const pr = gl.createProgram()!;
  gl.attachShader(pr, vs);
  gl.attachShader(pr, fs);
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return false;
  gl.useProgram(pr);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const pl = gl.getAttribLocation(pr, 'p');
  gl.enableVertexAttribArray(pl);
  gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [
    [gl.TEXTURE_MIN_FILTER, gl.NEAREST],
    [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
  ])
    gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  Object.assign(S, { gl, cv, R: gl.getUniformLocation(pr, 'R'), N: gl.getUniformLocation(pr, 'N') });
  return true;
}
/** Average each N×N block of src (exactly N times dst's size) into dst. */
export function ssDown(src: HTMLCanvasElement | OffscreenCanvas, dst: HTMLCanvasElement | OffscreenCanvas, N: number) {
  const w = dst.width,
    h = dst.height,
    x = (dst as HTMLCanvasElement).getContext('2d')!;
  if (S.ok && (!S.gl || S.gl.isContextLost())) {
    S.gl = null;
    if (!setup()) S.ok = false;
  }
  if (S.ok && S.gl && S.cv) {
    const gl = S.gl;
    if (S.cv.width !== w || S.cv.height !== h) {
      S.cv.width = w;
      S.cv.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as any);
    gl.uniform2f(S.R, 1 / src.width, 1 / src.height);
    gl.uniform1f(S.N, N);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'copy';
    x.drawImage(S.cv, 0, 0);
    x.restore();
    return;
  }
  const a = (src as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, w * N, h * N).data,
    o = x.createImageData(w, h),
    d = o.data,
    sw = w * N,
    q = 1 / (N * N);
  for (let y = 0; y < h; y++)
    for (let X = 0; X < w; X++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let j = 0; j < N; j++) {
        let k = ((y * N + j) * sw + X * N) * 4;
        for (let i = 0; i < N; i++, k += 4) {
          r += a[k];
          g += a[k + 1];
          b += a[k + 2];
        }
      }
      const m = (y * w + X) * 4;
      d[m] = r * q;
      d[m + 1] = g * q;
      d[m + 2] = b * q;
      d[m + 3] = 255;
    }
  x.putImageData(o, 0, 0);
}
/** Supersampling factor for a frame of this size and setting. */
export const ssFactor = (aa: string, w: number, h: number) => {
  const m = aa === 'ssaa3' ? 3 : aa === 'ssaa' ? 2 : 1;
  return Math.max(1, Math.min(m, Math.floor(8192 / Math.max(w, h))));
};
