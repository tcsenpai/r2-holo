/* =====================================================================
   R2 Holotable — procedural model + live reaction to Claude Code events

   One full-size droid for the main session, one smaller droid per live
   subagent. The subagent's droid SERIES is chosen from the model that
   produced the event:

     opus   -> R2-series, hemispherical dome
     sonnet -> R4-series, conical dome
     haiku  -> R5-series, short conical head (the cut-price unit)

   The head shapes are documented differences between the series. The
   size difference is an encoding choice, and is labelled as such.
   ===================================================================== */
(function(){
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ===================================================================
     1. SUBSYSTEMS
     Each module is a documented piece of R2-series equipment, mapped to
     the class of work it resembles.
     =================================================================== */
  var SYSTEMS = [
    {
      id:"sns", tag:"SNS", name:"Video sensor", kind:"std",
      label:"VIDEO SENSOR", anchor:[0, 3.15, 0.92],
      title:"Dome video sensor",
      note:"A fully maneuverable video sensor with 360° rotation and 0.85 m reach, backed by electromagnetic, heat, motion and life-form indicators. This is the module that moves when Claude Code looks: every read or search turns the dome.",
      specs:[
        ["Sensor","360° maneuverable video"],
        ["Reach","0.85 m"],
        ["Indicators","electromagnetic, heat, motion, life-form"],
        ["Transceiver","full-spectrum"]
      ],
      tools:"Read, Grep, Glob, LS"
    },
    {
      id:"scp", tag:"SCP", name:"Scomp arm", kind:"std",
      label:"COMPUTER SCOMP LINK", anchor:[0.45, 2.05, 1.10],
      title:"Computer interface arm",
      note:"The retractable arm R2 pushes into a data port to take a system over. Here it extends and spins on every shell command — the most honest equivalent of a <span>Bash</span> call there is.",
      specs:[
        ["Arm","retractable scomp link"],
        ["Reach","0.85 m"],
        ["Computer","Intellex IV"],
        ["Direct tap","retractable jack"],
        ["Welder","electric arc"]
      ],
      tools:"Bash, BashOutput, KillShell"
    },
    {
      id:"man", tag:"MAN", name:"Manipulator", kind:"std",
      label:"FINE MANIPULATOR", anchor:[-0.45, 1.78, 1.10],
      title:"Precision manipulator",
      note:"Three 360° joints and micrometer accuracy, for barely two kilos of payload. It is the surgical instrument, so it moves on writes and edits rather than on commands.",
      specs:[
        ["Joints","3 × 360°"],
        ["Accuracy","micrometer"],
        ["Payload","2 kg"],
        ["Heavy grasper","25 kg lift / 10 kg grip"],
        ["Tools","circular saw, arc welder"]
      ],
      tools:"Write, Edit, MultiEdit, NotebookEdit"
    },
    {
      id:"trx", tag:"TRX", name:"Transceiver", kind:"std",
      label:"TRANSCEIVER", anchor:[0.20, 4.10, 0],
      title:"Full-spectrum transceiver",
      note:"The antenna that talks to everything outside the hull. It lights up when the session reaches the network: searches, fetches, and calls into MCP servers.",
      specs:[
        ["Transceiver","full-spectrum"],
        ["Telecom","Imperial Navy and Corporate Sector protocols"],
        ["Library","ROM of repair schematics"]
      ],
      tools:"WebSearch, WebFetch, MCP tools"
    },
    {
      id:"vck", tag:"VCK", name:"Projector", kind:"std",
      label:"VICKSVISC PROJECTOR", anchor:[-0.38, 3.48, 0.58],
      title:"VicksVisc holographic recorder",
      note:"The projector that carried Leia's message. Here it is the module holding up the subagents: every time the session spawns one, R2 projects a smaller droid beside itself that works on its own.",
      specs:[
        ["Module","VicksVisc recorder/projector"],
        ["Memory","internal data bank"],
        ["Hold","internal cargo compartment"]
      ],
      tools:"Task, subagents"
    },
    {
      id:"ext", tag:"EXT", name:"Extinguisher", kind:"alert",
      label:"FIRE EXTINGUISHER", anchor:[0.58, 1.18, 1.00],
      title:"Onboard extinguisher",
      note:"The only emergency module R2 carries, and the only amber channel in this projection: it fires on <span>tool_result</span> entries flagged as errors. If it flashes often, something in the session is burning.",
      specs:[
        ["Module","internal fire extinguisher"],
        ["Trigger","tool_result with is_error"],
        ["Kit","electro-shock prod, tow cable"]
      ],
      tools:"failed tool_result"
    },
    {
      id:"int", tag:"INT", name:"Intellex IV", kind:"std",
      label:"INTELLEX IV", anchor:[0, 2.40, -1.00],
      title:"Intellex IV computer",
      note:"Over 700 spacecraft configurations in memory and more than ten thousand operations per second. This is the thinking module: it moves when the model writes prose instead of calling tools, and it keeps the token count.",
      specs:[
        ["Computer","Intellex IV"],
        ["Configurations","700+ spacecraft"],
        ["Throughput","10,000+ MPF ops/s"],
        ["Speech","binary / droidspeak"]
      ],
      tools:"model prose"
    },
    {
      id:"loc", tag:"LOC", name:"Locomotion", kind:"std",
      label:"LOCOMOTION", anchor:[0, 0.38, -0.20],
      title:"Tripod and third leg",
      note:"Two side legs and a retractable centre leg. Here the third leg deploys while the session is working and folds away when it goes quiet: the most readable status indicator the droid owns.",
      specs:[
        ["Height","0.96 m"],
        ["Manufacturer","Industrial Automaton"],
        ["Plating","durasteel"],
        ["Stance","two legs + retractable third"]
      ],
      tools:"human turns, session activity"
    }
  ];

  var MODKEYS = ["sns","scp","man","trx","vck","ext","int","loc"];
  function newMod(){
    var m = {};
    MODKEYS.forEach(function(k){ m[k] = {p:0, n:0}; });
    return m;
  }
  var MOD = newMod();

  var live = {
    lastTool:"—", model:"—", tokens:0, errors:0,
    events:0, lastAt:0, sidechains:0
  };

  /* A session is bursty by nature: a tool fires, then nothing happens for
     thirty seconds while the command runs or the model thinks. Decaying to
     idle after two seconds makes that look like a dead scene. So calls in
     flight are tracked, and the droid holds its working pose for as long as
     the call actually lasts — which is the truth, not filler. */
  var mainPend = {};
  var pendSeq = 0;
  var PEND_MAX = 300000;      // give up on an unmatched call after 5 min
  var WAIT_WINDOW = 90000;    // after this, the session is genuinely idle

  function pendStart(pend, ev){
    pend[ev.id || ("k"+(pendSeq++))] = { tool: ev.tool, at: Date.now() };
  }
  function pendEnd(pend, ev){
    if(ev.forId && pend[ev.forId]){ delete pend[ev.forId]; return; }
    var oldest=null, key=null;               // no id: close the oldest call
    Object.keys(pend).forEach(function(k){
      if(!oldest || pend[k].at < oldest.at){ oldest=pend[k]; key=k; }
    });
    if(key) delete pend[key];
  }
  /* Holds the matching module up while a call is open, and reports the
     longest-running one so the UI can show what everyone is waiting for. */
  function applyPending(pend, m){
    var now=Date.now(), oldest=null;
    Object.keys(pend).forEach(function(k){
      var P=pend[k];
      if(now - P.at > PEND_MAX){ delete pend[k]; return; }
      var id=moduleFor(P.tool);
      if(m[id].p < 0.62) m[id].p = 0.62;
      if(!oldest || P.at < oldest.at) oldest=P;
    });
    return oldest;
  }

  function moduleFor(tool){
    if(!tool) return "int";
    if(/^(Read|Grep|Glob|LS|NotebookRead|TodoRead)$/.test(tool)) return "sns";
    if(/^(Bash|BashOutput|KillShell|KillBash)$/.test(tool)) return "scp";
    if(/^(Write|Edit|MultiEdit|NotebookEdit|TodoWrite)$/.test(tool)) return "man";
    if(/^(WebSearch|WebFetch)$/.test(tool) || tool.indexOf("mcp__") === 0) return "trx";
    if(/^(Task|Agent)$/.test(tool)) return "vck";
    return "int";
  }

  /* --- droid series -------------------------------------------------
     Canon: the R4 is identical to the R2 except its dome is conical
     instead of hemispherical; the R5 has a shorter cone head and is the
     cut-price, unreliable unit. Scale encodes the model tier and is a
     reading aid, not a canonical dimension. -------------------------- */
  var SERIES = {
    r2: { head:"dome",      scale:0.52, label:"R2" },
    r4: { head:"cone",      scale:0.44, label:"R4" },
    r5: { head:"shortcone", scale:0.34, label:"R5" }
  };
  function seriesFor(model){
    var m = String(model || "").toLowerCase();
    if(m.indexOf("haiku")  >= 0) return "r5";
    if(m.indexOf("sonnet") >= 0) return "r4";
    return "r2";
  }

  /* ===================================================================
     2. SCENE
     =================================================================== */
  var stage = document.getElementById("stage");
  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x03070e, 0.018);
  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);

  var renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  stage.appendChild(renderer.domElement);

  var PROJ  = new THREE.Color(0x5fe3ff);
  var AMBER = new THREE.Color(0xffb454);
  // R2 carries a logic display: red and green status blips. Amber stays the
  // whole-body alarm, so the blips give per-result feedback without
  // overloading that channel.
  var GOOD  = 0x5ff0a8;
  var BAD   = 0xff5f6d;
  var uniforms = { uTime:{value:0}, uScan:{value:1} };
  var NOCLIP = 9999;

  function holoMaterial(color){
    return new THREE.ShaderMaterial({
      uniforms:{
        uColor:{value:color.clone()},
        uTime:uniforms.uTime,
        uScan:uniforms.uScan,
        uClipY:{value:NOCLIP}            // materialisation front, world Y
      },
      vertexShader:[
        "varying vec3 vN; varying vec3 vV; varying vec3 vW;",
        "void main(){",
        "  vec4 wp = modelMatrix * vec4(position,1.0);",
        "  vW = wp.xyz;",
        "  vN = normalize(mat3(modelMatrix) * normal);",
        "  vV = normalize(cameraPosition - wp.xyz);",
        "  gl_Position = projectionMatrix * viewMatrix * wp;",
        "}"
      ].join("\n"),
      fragmentShader:[
        "uniform vec3 uColor; uniform float uTime; uniform float uScan; uniform float uClipY;",
        "varying vec3 vN; varying vec3 vV; varying vec3 vW;",
        "void main(){",
        // the droid materialises bottom-up behind a glowing front
        "  if (vW.y > uClipY) discard;",
        "  float front = 1.0 - smoothstep(0.0, 0.5, uClipY - vW.y);",
        "  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));",
        "  f = pow(clamp(f,0.0,1.0), 1.7);",
        "  float bands = 0.5 + 0.5*sin(vW.y*9.0 - uTime*1.6);",
        "  float sweep = smoothstep(0.80,1.0, 0.5+0.5*sin(vW.y*0.55 - uTime*0.7));",
        "  float a = f*0.40 + bands*0.045*uScan + sweep*0.14*uScan;",
        "  vec3 c = uColor * (0.55 + f*0.85 + sweep*0.55*uScan);",
        "  c += vec3(0.55,0.85,1.0) * front * 2.0;",
        "  a = min(1.0, a + front*0.30);",
        "  gl_FragColor = vec4(c, a);",
        "}"
      ].join("\n"),
      transparent:true, blending:THREE.AdditiveBlending,
      depthWrite:false, side:THREE.DoubleSide
    });
  }
  function lineMaterial(color, opacity){
    var m = new THREE.LineBasicMaterial({
      color:color, transparent:true, opacity:opacity,
      blending:THREE.AdditiveBlending, depthWrite:false
    });
    m.userData.base = opacity;
    return m;
  }

  /* ===================================================================
     3. GEOMETRY HELPERS
     =================================================================== */
  function catmull(p0,p1,p2,p3,t){
    var t2=t*t,t3=t2*t;
    return 0.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3);
  }
  function resample(sec, sub){
    var out=[],n=sec.length;
    for(var i=0;i<n-1;i++){
      var p0=sec[Math.max(0,i-1)],p1=sec[i],p2=sec[i+1],p3=sec[Math.min(n-1,i+2)];
      for(var k=0;k<sub;k++){
        var t=k/sub;
        out.push({
          z:catmull(p0.z,p1.z,p2.z,p3.z,t),
          w:Math.max(0.004,catmull(p0.w,p1.w,p2.w,p3.w,t)),
          h:Math.max(0.004,catmull(p0.h,p1.h,p2.h,p3.h,t)),
          y:catmull(p0.y,p1.y,p2.y,p3.y,t)
        });
      }
    }
    out.push(sec[n-1]);
    return out;
  }
  var RAD=34;
  function ringPoint(s,a,e){
    var c=Math.cos(a),t=Math.sin(a);
    return [ s.w*(c<0?-1:1)*Math.pow(Math.abs(c),2/e),
             s.y + s.h*(t<0?-1:1)*Math.pow(Math.abs(t),2/e), s.z ];
  }
  function sweepMesh(sec,e,sub){
    var st=resample(sec,sub||4),pos=[];
    function quad(A,B,C,D){
      pos.push(A[0],A[1],A[2],B[0],B[1],B[2],C[0],C[1],C[2]);
      pos.push(A[0],A[1],A[2],C[0],C[1],C[2],D[0],D[1],D[2]);
    }
    for(var i=0;i<st.length-1;i++)
      for(var k=0;k<RAD;k++){
        var a0=(k/RAD)*Math.PI*2,a1=((k+1)/RAD)*Math.PI*2;
        quad(ringPoint(st[i],a0,e),ringPoint(st[i],a1,e),
             ringPoint(st[i+1],a1,e),ringPoint(st[i+1],a0,e));
      }
    [st[0],st[st.length-1]].forEach(function(cap,idx){
      var cen=[0,cap.y,cap.z];
      for(var m=0;m<RAD;m++){
        var b0=(m/RAD)*Math.PI*2,b1=((m+1)/RAD)*Math.PI*2;
        var p=ringPoint(cap,b0,e),q=ringPoint(cap,b1,e);
        if(idx===0) pos.push(cen[0],cen[1],cen[2],p[0],p[1],p[2],q[0],q[1],q[2]);
        else        pos.push(cen[0],cen[1],cen[2],q[0],q[1],q[2],p[0],p[1],p[2]);
      }
    });
    var g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
    g.computeVertexNormals();
    return g;
  }
  function sweepLines(sec,e,ringEvery,longCount,sub){
    var st=resample(sec,sub||4),pts=[];
    for(var i=0;i<st.length;i++){
      if(i%ringEvery!==0 && i!==st.length-1) continue;
      for(var k=0;k<RAD;k++){
        var p=ringPoint(st[i],(k/RAD)*Math.PI*2,e),q=ringPoint(st[i],((k+1)/RAD)*Math.PI*2,e);
        pts.push(p[0],p[1],p[2],q[0],q[1],q[2]);
      }
    }
    for(var c=0;c<longCount;c++){
      var ang=(c/longCount)*Math.PI*2;
      for(var j=0;j<st.length-1;j++){
        var u=ringPoint(st[j],ang,e),v=ringPoint(st[j+1],ang,e);
        pts.push(u[0],u[1],u[2],v[0],v[1],v[2]);
      }
    }
    var g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(pts,3));
    return g;
  }
  function edgesOf(g,a){ return new THREE.EdgesGeometry(g, a===undefined?24:a); }

  /* Shapes are identical across droids, so they are built once and
     shared. Only materials are per-droid, because each droid must be
     able to flash amber and materialise on its own. */
  var G = {};
  function geom(key, make){ return G[key] || (G[key] = make()); }

  function part(parent, g, lg, fill, line, pos, rot){
    var mesh=new THREE.Mesh(g, fill);
    var lines=new THREE.LineSegments(lg, line);
    if(pos){ mesh.position.set(pos[0],pos[1],pos[2]); lines.position.copy(mesh.position); }
    if(rot){ mesh.rotation.set(rot[0],rot[1],rot[2]); lines.rotation.copy(mesh.rotation); }
    parent.add(mesh); parent.add(lines);
    return {mesh:mesh, lines:lines};
  }

  /* --- easing -------------------------------------------------------
     Everything is a function of delta time: damping constants must not
     depend on frame rate, or the droid moves twice as fast at 120 Hz
     as it does at 60. ------------------------------------------------ */
  function damp(cur, target, lambda, dt){
    return target + (cur - target) * Math.exp(-lambda * dt);
  }
  function easeOutBack(x){
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3*Math.pow(x-1,3) + c1*Math.pow(x-1,2);
  }
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }

  /* -------------------------------------------------------------------
     buildDroid — the factory. Each call produces a complete droid with
     its own materials. `full` turns on the details only the primary
     unit earns (hull panels, projector cone).
     ------------------------------------------------------------------- */
  function buildDroid(opt){
    opt = opt || {};
    var full = !!opt.full;
    var headKind = opt.head || "dome";

    var M = {
      hull:  holoMaterial(PROJ),
      line:  lineMaterial(PROJ, full ? 0.55 : 0.48),
      faint: lineMaterial(PROJ, full ? 0.26 : 0.20)
    };
    var g = new THREE.Group();          // origin sits on the ground plane

    // body — inside a squash group so actions can compress it
    var squash = new THREE.Group();
    g.add(squash);
    var bodyBox = new THREE.Group();
    bodyBox.rotation.x = -Math.PI/2;
    squash.add(bodyBox);
    var bodySec = [
      {z:0.72, w:0.90, h:0.90, y:0},
      {z:1.10, w:0.94, h:0.94, y:0},
      {z:2.00, w:0.94, h:0.94, y:0},
      {z:2.55, w:0.92, h:0.92, y:0},
      {z:2.78, w:0.88, h:0.88, y:0}
    ];
    part(bodyBox,
      geom("body",  function(){ return sweepMesh(bodySec,2.1); }),
      geom("bodyL", function(){ return sweepLines(bodySec,2.1,5,10); }),
      M.hull, M.line);

    if(full){
      // panels are outlines only: no fill mesh
      squash.add(new THREE.LineSegments(geom("panels", function(){
        var pts=[];
        function panel(cx,cy,w,h){
          var r=0.945, cs=[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]];
          var p=cs.map(function(c){
            var a=cx+c[0]/r;
            return [Math.sin(a)*r, cy+c[1], Math.cos(a)*r];
          });
          for(var i=0;i<4;i++){
            var A=p[i],B=p[(i+1)%4];
            pts.push(A[0],A[1],A[2],B[0],B[1],B[2]);
          }
        }
        panel(-0.30,2.05,0.42,0.34); panel(0.30,2.05,0.42,0.34);
        panel(-0.30,1.55,0.42,0.50); panel(0.30,1.55,0.42,0.50);
        panel(0.00,1.05,0.55,0.34);
        var bg=new THREE.BufferGeometry();
        bg.setAttribute("position",new THREE.Float32BufferAttribute(pts,3));
        return bg;
      }), M.faint));
    }

    /* --- head: this is what distinguishes the series ---------------- */
    var dome = new THREE.Group();
    dome.position.y = 2.78;
    squash.add(dome);

    var eyeY, eyeZ, topY;
    if(headKind === "dome"){                       // R2: hemispherical
      part(dome,
        geom("headDome",  function(){ return new THREE.SphereGeometry(0.90,26,14,0,Math.PI*2,0,Math.PI/2); }),
        geom("headDomeE", function(){ return edgesOf(G["headDome"],34); }),
        M.hull, M.line, [0,0,0]);
      eyeY=0.36; eyeZ=0.79; topY=0.90;
    } else if(headKind === "cone"){                // R4: conical dome
      part(dome,
        geom("headCone",  function(){ var c=new THREE.ConeGeometry(0.90,1.10,26,1,true); c.translate(0,0.55,0); return c; }),
        geom("headConeE", function(){ return edgesOf(G["headCone"],28); }),
        M.hull, M.line, [0,0,0]);
      eyeY=0.34; eyeZ=0.62; topY=1.10;
    } else {                                       // R5: short cone head
      part(dome,
        geom("headShort",  function(){ var c=new THREE.ConeGeometry(0.90,0.66,24,1,true); c.translate(0,0.33,0); return c; }),
        geom("headShortE", function(){ return edgesOf(G["headShort"],28); }),
        M.hull, M.line, [0,0,0]);
      eyeY=0.22; eyeZ=0.60; topY=0.66;
    }

    // latitude bands, scaled to the head height
    dome.add(new THREE.LineSegments(geom("headBands", function(){
      var pts=[],seg=44;
      [0.34,0.64].forEach(function(f){
        var r=0.90*(1-f*0.55), y=f;
        for(var i=0;i<seg;i++){
          var a0=(i/seg)*Math.PI*2,a1=((i+1)/seg)*Math.PI*2;
          pts.push(Math.cos(a0)*r,y,Math.sin(a0)*r, Math.cos(a1)*r,y,Math.sin(a1)*r);
        }
      });
      var bg=new THREE.BufferGeometry();
      bg.setAttribute("position",new THREE.Float32BufferAttribute(pts,3));
      return bg;
    }), M.faint));

    // main photoreceptor
    part(dome,
      geom("eyeRing",  function(){ return new THREE.CylinderGeometry(0.24,0.24,0.16,16,1,true); }),
      geom("eyeRingE", function(){ return edgesOf(G["eyeRing"],20); }),
      M.hull, M.line, [0,eyeY,eyeZ], [Math.PI/2,0,0]);
    var eyeMat = new THREE.MeshBasicMaterial({
      color:0x9df2ff, transparent:true, opacity:0.5,
      blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide
    });
    var eye = new THREE.Mesh(geom("eyeLens", function(){ return new THREE.CircleGeometry(0.20,20); }), eyeMat);
    eye.position.set(0,eyeY,eyeZ+0.08);
    dome.add(eye);

    // logic display: the red/green blips that report the last result
    function blipMesh(parent, color, pos, r){
      var mm = new THREE.MeshBasicMaterial({
        color:color, transparent:true, opacity:0.07,
        blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide
      });
      var d = new THREE.Mesh(geom("blip"+r, function(){
        return new THREE.CircleGeometry(r, 14);
      }), mm);
      d.position.set(pos[0],pos[1],pos[2]);
      parent.add(d);
      return mm;
    }
    var blipGood = blipMesh(dome, GOOD, [ 0.31, eyeY-0.03, eyeZ*0.90], 0.055);
    var blipBad  = blipMesh(dome, BAD,  [-0.31, eyeY-0.03, eyeZ*0.90], 0.055);
    var logic = [];
    for(var li=0; li<4; li++){
      logic.push(blipMesh(squash, li%2 ? GOOD : BAD,
        [-0.21 + li*0.14, 2.32, 0.95], 0.035));
    }

    // antennas live in their own group so they can lag behind the dome
    var antennas = new THREE.Group();
    antennas.position.y = topY*0.92;
    dome.add(antennas);
    [[-0.16,0.06],[0.16,-0.04]].forEach(function(o){
      part(antennas,
        geom("ant",  function(){ return new THREE.CylinderGeometry(0.018,0.026,0.62,6); }),
        geom("antE", function(){ return edgesOf(G["ant"],30); }),
        M.hull, M.faint, [o[0],0.31,o[1]]);
    });

    // holographic projector head
    part(dome,
      geom("proj",  function(){ return new THREE.CylinderGeometry(0.09,0.12,0.22,12); }),
      geom("projE", function(){ return edgesOf(G["proj"],22); }),
      M.hull, M.faint, [-0.34,topY*0.78,0.50], [0.7,0,0.25]);

    var beamMat = null, beam = null;
    if(full){
      // The cone must be able to POINT, so the geometry has its apex at
      // the origin running along +Z: a lookAt() then aims the beam.
      beamMat = new THREE.MeshBasicMaterial({
        color:0x9df2ff, transparent:true, opacity:0,
        blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide
      });
      beam = new THREE.Mesh(geom("beam", function(){
        var bg = new THREE.ConeGeometry(0.34, 1, 22, 1, true);
        bg.translate(0, -0.5, 0);
        bg.rotateX(-Math.PI/2);   // +90° would send the tip toward -Z
        return bg;
      }), beamMat);
      beam.position.set(-0.34, 3.50, 0.50);
      beam.visible = false;
      g.add(beam);
    }

    /* --- legs: feet sit ON the ground plane, so leaning the group
       about its origin pivots around the contact patch -------------- */
    var FEET = [];
    [1,-1].forEach(function(sx){
      var leg=new THREE.Group();
      leg.position.set(sx*0.98,2.15,0);
      squash.add(leg);
      part(leg, geom("hipS", function(){ return new THREE.SphereGeometry(0.26,14,10); }),
                geom("hipSE",function(){ return edgesOf(G["hipS"],34); }), M.hull, M.faint, [0,0,0]);
      part(leg, geom("legU", function(){ return new THREE.CylinderGeometry(0.20,0.26,1.93,10); }),
                geom("legUE",function(){ return edgesOf(G["legU"],22); }), M.hull, M.line,
                [sx*0.12,-0.965,0],[0,0,sx*0.08]);
      var foot = part(leg, geom("foot", function(){ return new THREE.BoxGeometry(0.44,0.22,0.86); }),
                geom("footE",function(){ return edgesOf(G["foot"],22); }), M.hull, M.line,
                [sx*0.22,-2.04,0.06]);
      FEET.push({sx:sx, grp:leg, foot:foot});
    });

    // retractable third leg
    var centerLeg=new THREE.Group();
    centerLeg.position.set(0,0.75,0.30);
    squash.add(centerLeg);
    part(centerLeg, geom("cl", function(){ return new THREE.CylinderGeometry(0.14,0.17,0.55,10); }),
                    geom("clE",function(){ return edgesOf(G["cl"],22); }), M.hull, M.line, [0,-0.275,0]);
    part(centerLeg, geom("cf", function(){ return new THREE.BoxGeometry(0.34,0.20,0.72); }),
                    geom("cfE",function(){ return edgesOf(G["cf"],22); }), M.hull, M.line, [0,-0.65,0.08]);

    // scomp link arm
    var scomp=new THREE.Group();
    scomp.position.set(0.30,2.05,0.90);
    squash.add(scomp);
    var scompArm = part(scomp,
      geom("sc",  function(){ return new THREE.CylinderGeometry(0.075,0.095,0.72,10); }),
      geom("scE", function(){ return edgesOf(G["sc"],22); }), M.hull, M.line, [0,0,0.36],[Math.PI/2,0,0]);
    part(scomp, geom("scT", function(){ return new THREE.CylinderGeometry(0.14,0.10,0.18,10); }),
                geom("scTE",function(){ return edgesOf(G["scT"],22); }), M.hull, M.line, [0,0,0.76],[Math.PI/2,0,0]);

    // fine manipulator
    var manip=new THREE.Group();
    manip.position.set(-0.30,1.78,0.90);
    squash.add(manip);
    part(manip, geom("mn", function(){ return new THREE.CylinderGeometry(0.05,0.065,0.56,10); }),
                geom("mnE",function(){ return edgesOf(G["mn"],22); }), M.hull, M.line, [0,0,0.28],[Math.PI/2,0,0]);
    [[-0.06,0.06],[0.06,0.06],[0,-0.07]].forEach(function(o){
      part(manip, geom("fin", function(){ return new THREE.CylinderGeometry(0.018,0.026,0.22,6); }),
                  geom("finE",function(){ return edgesOf(G["fin"],30); }), M.hull, M.faint,
                  [o[0],o[1],0.64],[Math.PI/2,0,0]);
    });

    // arc welder sparks: real particles with velocity, gravity and life
    var SPARK_N = full ? 120 : 44;
    var sparkPos  = new Float32Array(SPARK_N*3);
    var sparkVel  = new Float32Array(SPARK_N*3);
    var sparkLife = new Float32Array(SPARK_N);
    for(var si=0; si<SPARK_N; si++) sparkPos[si*3+1] = -999;
    var sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos,3));
    var sparkMat = new THREE.PointsMaterial({
      color:0xcdf7ff, size: full?0.05:0.036, transparent:true, opacity:0,
      blending:THREE.AdditiveBlending, depthWrite:false
    });
    squash.add(new THREE.Points(sparkGeo, sparkMat));

    return {
      group:g, squash:squash, mats:M, dome:dome, eyeMat:eyeMat,
      antennas:antennas, scomp:scomp, scompArm:scompArm, manip:manip,
      blipGood:blipGood, blipBad:blipBad, logic:logic, good:0, bad:0,
      centerLeg:centerLeg, feet:FEET, beam:beam, beamMat:beamMat, topY:topY,
      sparkPos:sparkPos, sparkVel:sparkVel, sparkLife:sparkLife,
      sparkGeo:sparkGeo, sparkMat:sparkMat, SPARK_N:SPARK_N,
      domeCur:0, domeTarget:0, domeVel:0,
      antAng:0, antVel:0, lean:0, pitch:0, recoil:0, dip:0,
      blink:0, nextBlink:2+Math.random()*5, nextSweep:18+Math.random()*20,
      shake:new THREE.Vector3(), shakeMag:0, clip:NOCLIP
    };
  }

  /* -------------------------------------------------------------------
     animateDroid — the same rig drives the primary and every subagent
     ------------------------------------------------------------------- */
  var tmpColor = new THREE.Color();
  function animateDroid(r2, m, t, dt, idle){
    /* --- dome: an under-damped spring. A linear lerp turns the head
       like a turntable; a real astromech snaps it and lets it settle. */
    if(idle && !reduce){
      r2.domeTarget += Math.sin(t*0.21 + r2.group.position.x)*0.004;
      r2.nextSweep -= dt;
      if(r2.nextSweep <= 0){            // occasional full watch sweep
        r2.domeTarget += (Math.random()<0.5?-1:1)*Math.PI*2;
        r2.nextSweep = 20 + Math.random()*25;
      }
    }
    var k = 78 + m.sns.p*60, c = 10.5;
    r2.domeVel += (-(r2.domeCur - r2.domeTarget)*k - r2.domeVel*c) * dt;
    r2.domeCur += r2.domeVel * dt;
    r2.dome.rotation.y = r2.domeCur;
    r2.dome.rotation.z = damp(r2.dome.rotation.z, clamp(-r2.domeVel*0.016,-0.12,0.12), 9, dt);

    /* --- antennas lag behind: secondary motion is what sells a rig --- */
    var antT = clamp(-r2.domeVel*0.030, -0.45, 0.45);
    r2.antVel += (-(r2.antAng - antT)*150 - r2.antVel*8) * dt;
    r2.antAng += r2.antVel * dt;
    r2.antennas.rotation.z = r2.antAng;
    r2.antennas.rotation.x = r2.antAng*0.35;

    /* --- eye: level plus an occasional blink --- */
    r2.nextBlink -= dt;
    if(r2.nextBlink <= 0){ r2.blink = 1; r2.nextBlink = 2.5 + Math.random()*6; }
    r2.blink = Math.max(0, r2.blink - dt*7);
    var eyeBase = 0.30 + m.sns.p*0.60 + (idle?0:0.10);
    r2.eyeMat.opacity = Math.max(0.04, eyeBase * (1 - r2.blink*0.9));

    /* --- logic display: a green blip on a clean result, red on a failure,
       plus a slow idle chase so the row never looks dead --- */
    r2.good = Math.max(0, r2.good - dt*2.2);
    r2.bad  = Math.max(0, r2.bad  - dt*2.2);
    r2.blipGood.opacity = 0.07 + r2.good*0.9;
    r2.blipBad.opacity  = 0.07 + r2.bad*0.9;
    for(var bi=0; bi<r2.logic.length; bi++){
      var chase = Math.max(0, Math.sin(t*2.6 - bi*0.9));
      r2.logic[bi].opacity = 0.04 + chase*0.10 +
        (bi%2 ? r2.good : r2.bad) * 0.55;
    }

    /* --- weight: the body leans toward the working arm and dips as an
       action starts. Both pivot at the ground, so the feet stay put. --- */
    var leanT = (m.scp.p*0.050) - (m.man.p*0.050);
    r2.lean = damp(r2.lean, clamp(leanT,-0.07,0.07), 7, dt);
    r2.group.rotation.z = r2.lean;

    var load = Math.min(1, m.scp.p + m.man.p);
    r2.dip = damp(r2.dip, load*0.035, 9, dt);
    r2.squash.scale.set(1 + r2.dip*0.5, 1 - r2.dip, 1 + r2.dip*0.5);

    /* --- an error makes it recoil, not just rattle --- */
    var ex = Math.min(1, m.ext.p);
    r2.recoil = damp(r2.recoil, -ex*0.16, 8, dt);
    r2.pitch = damp(r2.pitch, -Math.min(0.06,(m.scp.p+m.man.p)*0.03), 7, dt);
    r2.group.rotation.x = r2.pitch + r2.recoil;

    /* --- the outer foot lifts a little when the droid leans --- */
    for(var fi=0; fi<r2.feet.length; fi++){
      var F = r2.feet[fi];
      var lift = Math.max(0, -F.sx * r2.lean) * 1.1;
      F.foot.mesh.position.y = -2.04 + lift;
      F.foot.lines.position.y = F.foot.mesh.position.y;
      F.foot.mesh.rotation.z = -r2.lean*0.8;
      F.foot.lines.rotation.z = F.foot.mesh.rotation.z;
    }

    /* --- scomp arm: pops out, spins, eases back --- */
    var sc = Math.min(1, m.scp.p);
    var scT = 0.90 + easeOutBack(Math.min(1,sc*1.25))*0.32;
    r2.scomp.position.z = damp(r2.scomp.position.z, sc>0.03?scT:0.90, sc>0.03?22:6, dt);
    r2.scompArm.mesh.rotation.z += sc*22*dt;
    r2.scompArm.lines.rotation.z = r2.scompArm.mesh.rotation.z;

    /* --- manipulator: short extension and a fine tremor --- */
    var mn = Math.min(1, m.man.p);
    r2.manip.position.z = damp(r2.manip.position.z, 0.90 + mn*0.24, mn>0.03?24:6, dt);
    r2.manip.rotation.z = Math.sin(t*26)*0.05*mn;
    r2.manip.rotation.x = Math.sin(t*19+1.3)*0.035*mn;

    /* --- sparks fly off whichever tool is active --- */
    var weld = Math.max(m.scp.p, m.man.p*0.75);
    r2.sparkMat.opacity = Math.min(0.9, 0.35 + weld*0.6);
    var onScomp = m.scp.p >= m.man.p;
    var ox = onScomp ?  0.30 : -0.30;
    var oy = onScomp ?  2.05 :  1.78;
    var oz = onScomp ?  1.66 :  1.54;
    var budget = weld > 0.05 ? Math.ceil(weld*4) : 0;
    for(var i=0;i<r2.SPARK_N;i++){
      if(r2.sparkLife[i] > 0){
        r2.sparkLife[i] -= dt;
        r2.sparkVel[i*3+1] -= 6.5*dt;
        r2.sparkVel[i*3]   *= (1 - 1.6*dt);
        r2.sparkVel[i*3+2] *= (1 - 1.6*dt);
        r2.sparkPos[i*3]   += r2.sparkVel[i*3]*dt;
        r2.sparkPos[i*3+1] += r2.sparkVel[i*3+1]*dt;
        r2.sparkPos[i*3+2] += r2.sparkVel[i*3+2]*dt;
        if(r2.sparkLife[i] <= 0) r2.sparkPos[i*3+1] = -999;
      } else if(budget > 0){
        budget--;
        r2.sparkLife[i] = 0.35 + Math.random()*0.5;
        r2.sparkPos[i*3]   = ox + (Math.random()-0.5)*0.06;
        r2.sparkPos[i*3+1] = oy + (Math.random()-0.5)*0.06;
        r2.sparkPos[i*3+2] = oz + (Math.random()-0.5)*0.06;
        var sp = 0.9 + Math.random()*1.9;
        var th = Math.random()*Math.PI*2, ph = 0.25 + Math.random()*1.0;
        r2.sparkVel[i*3]   = Math.cos(th)*Math.sin(ph)*sp;
        r2.sparkVel[i*3+1] = Math.cos(ph)*sp*0.8 + 0.6;
        r2.sparkVel[i*3+2] = Math.sin(th)*Math.sin(ph)*sp + 0.9;
      }
    }
    r2.sparkGeo.attributes.position.needsUpdate = true;

    /* --- third leg, and the body rises a touch as it deploys --- */
    var act = idle ? 0 : 1;
    r2.centerLeg.scale.y = damp(r2.centerLeg.scale.y, 0.25 + act*0.75, 3.2, dt);
    r2.centerLeg.visible = r2.centerLeg.scale.y > 0.28;

    /* --- amber: errors only --- */
    tmpColor.copy(PROJ).lerp(AMBER, ex);
    r2.mats.hull.uniforms.uColor.value.copy(tmpColor);
    r2.mats.line.color.copy(tmpColor);
    r2.mats.faint.color.copy(tmpColor);
    r2.shakeMag = damp(r2.shakeMag, ex*0.09, 14, dt);
    if(r2.shakeMag > 0.001 && !reduce){
      r2.shake.set((Math.random()-0.5)*r2.shakeMag, 0, (Math.random()-0.5)*r2.shakeMag);
    } else {
      r2.shake.set(0,0,0);
    }
    return ex;
  }

  /* a snapped dome anticipates: a small kick the other way first */
  function turnDome(r2, delta){
    r2.domeVel -= Math.sign(delta) * 1.6;
    r2.domeTarget += delta;
  }

  /* --- primary droid --- */
  var droid = new THREE.Group();     // shake container
  scene.add(droid);
  var MAIN = buildDroid({full:true, head:"dome"});
  droid.add(MAIN.group);

  /* ===================================================================
     4. SUBAGENT DROIDS
     =================================================================== */
  var agentsLayer = document.getElementById("agents");
  var AGENTS = {};
  var SLOTS = 10;
  var slotUsed = [];
  var AGENT_TTL = 60000;             // 60 s of silence and the droid fades out
  var NEST_WINDOW = 120000;          // a Task this recent can claim a new agent

  // The transcript has no parent id: attributionAgent is the agent TYPE.
  // So nesting is inferred — the last subagent that called Task claims the
  // next agent file that shows up. Timing-based, and labelled as such.
  var lastTask = { agent:null, at:0 };
  // During a backlog replay only agents that were still active near the end
  // get a droid, otherwise every subagent that ever ran would materialise.
  var aliveFilter = null;

  function freeSlot(){
    for(var i=0;i<SLOTS;i++) if(!slotUsed[i]) { slotUsed[i]=true; return i; }
    return Math.floor(Math.random()*SLOTS);
  }

  function buildAgentBody(A, seriesKey){
    if(A.r2){
      A.wrap.remove(A.r2.group);
      A.r2.group.traverse(function(o){
        if(o.geometry && !SHARED.has(o.geometry)) o.geometry.dispose();
        if(o.material) o.material.dispose();
      });
    }
    var S = SERIES[seriesKey] || SERIES.r2;
    A.series = seriesKey;
    A.r2 = buildDroid({full:false, head:S.head});
    A.targetScale = S.scale * (A.parent ? 0.62 : 1);   // children sit smaller
    A.wrap.add(A.r2.group);
    A.el.querySelector(".aser").textContent = S.label;
    // (re)start the materialisation wipe
    A.clipT = 0;
  }

  var SHARED = new Set();
  function markShared(){ SHARED.clear(); Object.keys(G).forEach(function(k){ SHARED.add(G[k]); }); }

  function ensureAgent(id, model, evTime){
    if(AGENTS[id]) return AGENTS[id];
    if(aliveFilter && !aliveFilter.has(id)) return null;   // long finished
    if(evTime && Date.now() - evTime > AGENT_TTL) return null;

    // inferred parent: a subagent that called Task moments ago
    var parentId = null;
    if(lastTask.agent && lastTask.agent !== id && AGENTS[lastTask.agent] &&
       Date.now() - lastTask.at < NEST_WINDOW){
      parentId = lastTask.agent;
    }

    var slot = freeSlot();
    var wrap = new THREE.Group();
    if(parentId){
      var P = AGENTS[parentId];
      P.kids = (P.kids || 0) + 1;
      var ca = (P.kids-1) * 1.25 + 0.6;
      var cr = 2.7 * (P.targetScale/0.52);
      wrap.position.set(P.wrap.position.x + Math.cos(ca)*cr, 0,
                        P.wrap.position.z + Math.sin(ca)*cr);
      wrap.rotation.y = -Math.atan2(P.wrap.position.z - wrap.position.z,
                                    P.wrap.position.x - wrap.position.x) + Math.PI/2;
    } else {
      var ang = (slot/SLOTS)*Math.PI*2 + 0.35;
      var R = 5.6;
      wrap.position.set(Math.cos(ang)*R, 0, Math.sin(ang)*R);
      wrap.rotation.y = -ang + Math.PI/2;      // face the centre
    }
    wrap.scale.setScalar(0.001);
    scene.add(wrap);

    var el = document.createElement("div");
    el.className = "agent-tag";
    el.innerHTML = '<span class="aser">R2</span><span class="aid">'+id+'</span>'+
                   '<span class="atool">—</span><span class="atype"></span>';
    if(parentId) el.dataset.child = "1";
    agentsLayer.appendChild(el);

    var A = { id:id, wrap:wrap, r2:null, mod:newMod(), lastAt:evTime||Date.now(),
              slot:slot, el:el, dying:false, t:0, clipT:0, kids:0,
              parent:parentId, series:null, targetScale:0.42, pend:{} };
    AGENTS[id] = A;
    buildAgentBody(A, seriesFor(model));
    markShared();

    shock(wrap.position.x, 0.02, wrap.position.z, 0.2, 3.0, 1.0, false);
    return A;
  }

  function killAgent(id){
    var A = AGENTS[id]; if(!A) return;
    scene.remove(A.wrap);
    A.wrap.traverse(function(o){
      if(o.geometry && !SHARED.has(o.geometry)) o.geometry.dispose();
      if(o.material) o.material.dispose();
    });
    if(A.el.parentNode) A.el.parentNode.removeChild(A.el);
    if(A.tether){ scene.remove(A.tether); A.tether.geometry.dispose(); A.tether.material.dispose(); }
    slotUsed[A.slot] = false;
    delete AGENTS[id];
    // children outlive their parent: re-home them onto the primary droid
    Object.keys(AGENTS).forEach(function(k){
      if(AGENTS[k].parent === id){
        AGENTS[k].parent = null;
        AGENTS[k].el.dataset.child = "0";
      }
    });
  }
  function activeAgents(){ return Object.keys(AGENTS).length; }

  /* ===================================================================
     5. PROJECTION FLOOR
     =================================================================== */
  var gridGroup = new THREE.Group();
  scene.add(gridGroup);
  (function(){
    var pts=[];
    [1.4,2.8,4.2,5.6,7,8.4,9.8].forEach(function(r){
      var seg=72;
      for(var i=0;i<seg;i++){
        var a0=(i/seg)*Math.PI*2,a1=((i+1)/seg)*Math.PI*2;
        pts.push(Math.cos(a0)*r,0,Math.sin(a0)*r, Math.cos(a1)*r,0,Math.sin(a1)*r);
      }
    });
    for(var k=0;k<16;k++){
      var a=(k/16)*Math.PI*2;
      pts.push(Math.cos(a)*1.4,0,Math.sin(a)*1.4, Math.cos(a)*9.8,0,Math.sin(a)*9.8);
    }
    var g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(pts,3));
    gridGroup.add(new THREE.LineSegments(g, lineMaterial(PROJ,0.15)));
  })();

  var WAVES = [];
  (function(){
    var pts=[],seg=64;
    for(var i=0;i<seg;i++){
      var a0=(i/seg)*Math.PI*2,a1=((i+1)/seg)*Math.PI*2;
      pts.push(Math.cos(a0),0,Math.sin(a0), Math.cos(a1),0,Math.sin(a1));
    }
    var wg=new THREE.BufferGeometry();
    wg.setAttribute("position",new THREE.Float32BufferAttribute(pts,3));
    for(var w=0;w<12;w++){
      var wm=lineMaterial(PROJ,0);
      var wo=new THREE.LineSegments(wg,wm);
      wo.visible=false;
      scene.add(wo);
      WAVES.push({obj:wo,mat:wm,life:0,dur:1,r0:0,r1:1});
    }
  })();
  function shock(x,y,z,r0,r1,dur,amber){
    for(var i=0;i<WAVES.length;i++){
      var W=WAVES[i];
      if(W.life>0) continue;
      W.life=1; W.dur=dur; W.r0=r0; W.r1=r1;
      W.obj.position.set(x,y,z);
      W.obj.visible=true;
      W.mat.color.copy(amber?AMBER:PROJ);
      return;
    }
  }

  var scanRing;
  (function(){
    var pts=[],seg=96,r=6.8;
    for(var i=0;i<seg;i++){
      var a0=(i/seg)*Math.PI*2,a1=((i+1)/seg)*Math.PI*2;
      pts.push(Math.cos(a0)*r,0,Math.sin(a0)*r, Math.cos(a1)*r,0,Math.sin(a1)*r);
    }
    var g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(pts,3));
    scanRing=new THREE.LineSegments(g, lineMaterial(PROJ,0.45));
    scene.add(scanRing);
  })();

  (function(){
    var n=340,arr=new Float32Array(n*3);
    for(var i=0;i<n;i++){
      var r=4+Math.random()*15,a=Math.random()*Math.PI*2;
      arr[i*3]=Math.cos(a)*r; arr[i*3+1]=Math.random()*9; arr[i*3+2]=Math.sin(a)*r;
    }
    var g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.BufferAttribute(arr,3));
    scene.add(new THREE.Points(g,new THREE.PointsMaterial({
      color:0x5fe3ff,size:0.04,transparent:true,opacity:0.42,
      blending:THREE.AdditiveBlending,depthWrite:false
    })));
  })();

  /* ===================================================================
     5b. HOLOGRAPHIC WORKSHOP
     A projected maintenance bay around the droids. Everything is line
     work in the same palette, one step dimmer, so it reads as set
     dressing and never competes with the units themselves.
     =================================================================== */
  var workshop = new THREE.Group();
  scene.add(workshop);

  (function buildWorkshop(){
    // Dimmer than the droids, but not so dim the bay disappears into fog.
    var wLine  = lineMaterial(PROJ, 0.30);
    var wFaint = lineMaterial(PROJ, 0.16);
    var wWarm  = lineMaterial(AMBER, 0.20);
    workshop.scale.setScalar(0.74);   // pull the bay in around the holotable

    function boxLines(w,h,d){ return edgesOf(new THREE.BoxGeometry(w,h,d), 1); }
    function addBox(parent,w,h,d,pos,rotY,mat){
      var o=new THREE.LineSegments(boxLines(w,h,d), mat||wLine);
      o.position.set(pos[0],pos[1],pos[2]);
      if(rotY) o.rotation.y=rotY;
      parent.add(o);
      return o;
    }

    // bay floor markings
    (function(){
      var pts=[], w=7.4, d=5.2, x0=-w/2, z0=-d/2;
      [[x0,z0,x0+w,z0],[x0+w,z0,x0+w,z0+d],[x0+w,z0+d,x0,z0+d],[x0,z0+d,x0,z0]]
        .forEach(function(e){ pts.push(e[0],0.01,e[1], e[2],0.01,e[3]); });
      for(var i=1;i<10;i++){
        var x=x0+(w/10)*i;
        pts.push(x,0.01,z0, x-0.5,0.01,z0+0.5);
      }
      var g=new THREE.BufferGeometry();
      g.setAttribute("position",new THREE.Float32BufferAttribute(pts,3));
      var o=new THREE.LineSegments(g,wWarm);
      o.position.set(0,0,-8.6);
      workshop.add(o);
    })();

    // workbench with a tool rack
    var bench = new THREE.Group();
    bench.position.set(-8.2, 0, -2.2);
    bench.rotation.y = 0.9;
    workshop.add(bench);
    addBox(bench, 4.6, 0.16, 1.5, [0, 1.05, 0]);
    [-2.0, 2.0].forEach(function(x){
      addBox(bench, 0.16, 1.05, 1.3, [x, 0.52, 0], 0, wFaint);
    });
    addBox(bench, 4.6, 0.9, 0.08, [0, 2.15, -0.6], 0, wFaint);
    for(var ti=0; ti<5; ti++){
      var tool=new THREE.LineSegments(boxLines(0.07, 0.5 + (ti%3)*0.22, 0.07), wLine);
      tool.position.set(-1.7 + ti*0.85, 1.95 - (ti%3)*0.1, -0.5);
      bench.add(tool);
    }

    // parts crates
    [[7.6,-3.4,0.5],[8.4,-1.2,-0.3],[6.9,-4.6,1.1]].forEach(function(c,i){
      addBox(workshop, 1.2, 1.2, 1.2, [c[0], 0.6, c[1]], c[2], i===1?wFaint:wLine);
    });
    addBox(workshop, 1.2, 1.2, 1.2, [7.6, 1.8, -3.4], 0.5, wFaint);

    // overhead gantry with a hook on a cable
    var gantry = new THREE.Group();
    gantry.position.y = 7.6;
    workshop.add(gantry);
    [-3.2, 3.2].forEach(function(z){
      var r=new THREE.LineSegments(boxLines(17, 0.18, 0.18), wLine);
      r.position.set(0, 0, z);
      gantry.add(r);
    });
    var trolley = new THREE.LineSegments(boxLines(1.1, 0.5, 6.8), wLine);
    gantry.add(trolley);
    var cg=new THREE.BufferGeometry();
    cg.setAttribute("position", new THREE.Float32BufferAttribute([0,0,0, 0,-2.6,0],3));
    var cable=new THREE.Line(cg, wFaint);
    gantry.add(cable);
    var hook = new THREE.LineSegments(boxLines(0.5,0.5,0.5), wLine);
    hook.position.y = -2.85;
    gantry.add(hook);

    // corner pylons
    [[-9.5,-9.5],[9.5,-9.5],[-9.5,9.5],[9.5,9.5]].forEach(function(c){
      addBox(workshop, 0.4, 8.2, 0.4, [c[0], 4.1, c[1]], 0, wFaint);
    });

    // diagnostic screen on a stand
    var screen = new THREE.Group();
    screen.position.set(2.6, 0, -8.0);
    screen.rotation.y = -0.35;
    workshop.add(screen);
    addBox(screen, 0.2, 2.2, 0.2, [0, 1.1, 0], 0, wFaint);
    addBox(screen, 2.6, 1.6, 0.1, [0, 3.0, 0]);
    // The screen is a real canvas: the last tool in plain type over a
    // glyph rain whose speed tracks how busy the session is.
    var monitor = (function(){
      var cv = document.createElement("canvas");
      cv.width = 512; cv.height = 320;
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#000"; ctx.fillRect(0,0,cv.width,cv.height);

      var GLYPHS = "\u30a2\u30ab\u30b5\u30bf\u30ca\u30cf\u30de\u30e4\u30e9\u30ef" +
                   "0123456789<>[]{}/\\|=+*#";
      var COLW = 18, COLS = Math.floor(cv.width/COLW);
      var col = [];
      for(var i=0;i<COLS;i++){
        col.push({ y: Math.random()*cv.height, sp: 40 + Math.random()*90 });
      }

      var tex = new THREE.CanvasTexture(cv);
      tex.minFilter = THREE.LinearFilter;
      var mat = new THREE.MeshBasicMaterial({
        map:tex, transparent:true, opacity:0.9,
        blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide
      });
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.46, 1.48), mat);
      mesh.position.set(0, 3.0, 0.07);
      screen.add(mesh);

      var acc = 0;
      function draw(dt, st, busy, events, errors){
        // trailing fade — ordinary 2D compositing inside the canvas, even
        // though the texture itself is blended additively in the scene
        ctx.fillStyle = "rgba(0,0,0,0.26)";
        ctx.fillRect(0,0,cv.width,cv.height);

        ctx.font = "15px ui-monospace, Menlo, monospace";
        ctx.textAlign = "left";
        for(var c=0;c<COLS;c++){
          var C = col[c];
          C.y += C.sp * (0.5 + busy*1.8) * dt;
          if(C.y > cv.height + 40){ C.y = -20; C.sp = 40 + Math.random()*90; }
          var ch = GLYPHS[(Math.random()*GLYPHS.length)|0];
          ctx.fillStyle = "rgba(160,250,255,0.95)";          // bright head
          ctx.fillText(ch, c*COLW + 3, C.y);
          ctx.fillStyle = "rgba(60,170,200,0.45)";           // dimmer trail
          ctx.fillText(GLYPHS[(Math.random()*GLYPHS.length)|0], c*COLW + 3, C.y - 19);
        }

        // readout panel on top, redrawn every frame so it never fades
        ctx.fillStyle = "rgba(0,0,0,0.72)";
        ctx.fillRect(0, 96, cv.width, 108);
        ctx.strokeStyle = "rgba(95,227,255,0.55)";
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 97, cv.width-2, 106);

        ctx.fillStyle = st.mode === "run" ? "rgba(95,240,168,0.9)"
                      : st.mode === "wait" ? "rgba(255,180,84,0.9)"
                      : "rgba(95,227,255,0.7)";
        ctx.font = "13px ui-monospace, Menlo, monospace";
        ctx.fillText(st.head, 16, 122);
        if(st.secs > 0){
          ctx.textAlign = "right";
          ctx.fillText(st.secs + "s", cv.width-16, 122);
          ctx.textAlign = "left";
        }

        ctx.fillStyle = "#eaf7ff";
        ctx.font = "bold 38px ui-monospace, Menlo, monospace";
        var t = String(st.label || "—");
        if(t.length > 17) t = t.slice(0,16) + "\u2026";
        ctx.fillText(t, 16, 168);

        ctx.fillStyle = "rgba(139,163,184,0.8)";
        ctx.font = "13px ui-monospace, Menlo, monospace";
        ctx.fillText("EV " + events, 16, 194);
        ctx.fillStyle = errors > 0 ? "rgba(255,95,109,0.9)" : "rgba(95,240,168,0.8)";
        ctx.fillText("ERR " + errors, 110, 194);

        tex.needsUpdate = true;
      }

      return {
        tick: function(dt, st, busy, events, errors){
          acc += dt;
          if(acc < 0.055) return;      // ~18 fps is plenty for a prop
          draw(Math.min(0.12, acc), st, busy, events, errors);
          acc = 0;
        }
      };
    })();

    workshop.userData = { trolley:trolley, hook:hook, monitor:monitor };
  })();

  /* ===================================================================
     6. ORBIT CONTROLS
     =================================================================== */
  /* R2 does not stand still while it works: it rolls around the bay,
     turns to face where it is going and banks into the corners. */
  var roam = {
    pos:new THREE.Vector3(), target:new THREE.Vector3(),
    heading:0, bank:0, next:0, speed:0
  };
  var roamOn = !reduce;

  var cam = {theta:0.62, phi:1.18, radius:15.5, target:new THREE.Vector3(0,1.9,0)};
  var HOME = {theta:0.62, phi:1.18, radius:15.5};
  var autoSpin = !reduce;

  function applyCamera(){
    cam.phi = clamp(cam.phi, 0.22, Math.PI-0.22);
    cam.radius = clamp(cam.radius, 5, 40);
    var s=Math.sin(cam.phi);
    camera.position.set(
      cam.target.x + cam.radius*s*Math.sin(cam.theta),
      cam.target.y + cam.radius*Math.cos(cam.phi),
      cam.target.z + cam.radius*s*Math.cos(cam.theta)
    );
    camera.lookAt(cam.target);
  }
  var drag=null, pinch=null, el=renderer.domElement;
  el.addEventListener("pointerdown",function(e){
    el.setPointerCapture(e.pointerId); drag={x:e.clientX,y:e.clientY};
    autoSpin=false; syncSpin();
  });
  el.addEventListener("pointermove",function(e){
    if(!drag) return;
    cam.theta -= (e.clientX-drag.x)*0.006;
    cam.phi   -= (e.clientY-drag.y)*0.006;
    drag.x=e.clientX; drag.y=e.clientY; applyCamera();
  });
  function endDrag(e){ if(drag){ try{el.releasePointerCapture(e.pointerId);}catch(x){} } drag=null; }
  el.addEventListener("pointerup",endDrag);
  el.addEventListener("pointercancel",endDrag);
  el.addEventListener("wheel",function(e){
    e.preventDefault();
    cam.radius *= (1+Math.sign(e.deltaY)*0.09); applyCamera();
  },{passive:false});
  el.addEventListener("touchmove",function(e){
    if(e.touches.length===2){
      e.preventDefault();
      var dx=e.touches[0].clientX-e.touches[1].clientX;
      var dy=e.touches[0].clientY-e.touches[1].clientY;
      var d=Math.sqrt(dx*dx+dy*dy);
      if(pinch){ cam.radius *= pinch/d; applyCamera(); }
      pinch=d;
    }
  },{passive:false});
  el.addEventListener("touchend",function(){ pinch=null; });

  /* ===================================================================
     7. RAIL, HOTSPOTS, READOUT
     =================================================================== */
  var rail=document.getElementById("rail");
  var spotsLayer=document.getElementById("spots");
  var readout=document.getElementById("readout");

  var head=document.createElement("div");
  head.className="eyebrow rail-h"; head.textContent="Subsystems";
  rail.appendChild(head);

  var active=SYSTEMS[0].id, railEls={}, spotEls={};

  SYSTEMS.forEach(function(sys){
    var b=document.createElement("button");
    b.className="sysbtn"; b.setAttribute("role","tab");
    b.dataset.kind=sys.kind; b.dataset.id=sys.id;
    b.innerHTML='<span class="tag">'+sys.tag+'</span><span class="name">'+sys.name+'</span><span class="n">0</span>';
    b.addEventListener("click",function(){ select(sys.id); });
    rail.appendChild(b);
    railEls[sys.id]=b;

    var holder=document.createElement("div");
    holder.className="spot"; holder.dataset.kind=sys.kind; holder.dataset.id=sys.id;
    var hb=document.createElement("button");
    hb.setAttribute("aria-label",sys.title);
    hb.addEventListener("click",function(){ select(sys.id); });
    var lbl=document.createElement("span");
    lbl.className="lbl"; lbl.textContent=sys.label;
    holder.appendChild(hb); holder.appendChild(lbl);
    spotsLayer.appendChild(holder);
    spotEls[sys.id]={holder:holder, vec:new THREE.Vector3(sys.anchor[0],sys.anchor[1],sys.anchor[2])};
  });

  function fmtN(n){ return n.toLocaleString("en-US"); }
  function fleetSummary(){
    var c={r2:0,r4:0,r5:0};
    Object.keys(AGENTS).forEach(function(id){ c[AGENTS[id].series] = (c[AGENTS[id].series]||0)+1; });
    var out=[];
    if(c.r2) out.push(c.r2+"× R2");
    if(c.r4) out.push(c.r4+"× R4");
    if(c.r5) out.push(c.r5+"× R5");
    return out.length ? out.join(", ") : "none";
  }

  function renderReadout(){
    var sys=SYSTEMS.filter(function(s){return s.id===active;})[0];
    var m=MOD[sys.id];
    var rows=sys.specs.map(function(p){ return "<dt>"+p[0]+"</dt><dd>"+p[1]+"</dd>"; }).join("");
    readout.dataset.kind=sys.kind;
    readout.innerHTML =
      '<div class="eyebrow">'+sys.tag+' &middot; '+sys.label+'</div>'+
      '<h2>'+sys.title+'</h2>'+
      '<p class="note">'+sys.note+'</p>'+
      '<dl class="specs">'+rows+'</dl>'+
      '<div class="eyebrow live-h">Telemetry</div>'+
      '<dl class="specs">'+
        '<dt>Activations</dt><dd>'+fmtN(m.n)+'</dd>'+
        '<dt>Source</dt><dd>'+sys.tools+'</dd>'+
        '<dt>Last tool</dt><dd>'+live.lastTool+'</dd>'+
        '<dt>Fleet</dt><dd>'+fleetSummary()+'</dd>'+
        '<dt>Model</dt><dd>'+live.model+'</dd>'+
        '<dt>Events</dt><dd>'+fmtN(live.events)+'</dd>'+
        '<dt>Errors</dt><dd>'+fmtN(live.errors)+'</dd>'+
        '<dt>From subagents</dt><dd>'+fmtN(live.sidechains)+'</dd>'+
        '<dt>Tokens</dt><dd>'+fmtN(live.tokens)+'</dd>'+
      '</dl>';
  }
  function select(id){
    active=id;
    Object.keys(railEls).forEach(function(k){
      railEls[k].setAttribute("aria-selected", k===id ? "true":"false");
    });
    Object.keys(spotEls).forEach(function(k){
      spotEls[k].holder.dataset.on = k===id ? "1":"0";
    });
    renderReadout();
  }

  var tmp=new THREE.Vector3();
  function updateSpots(w,h){
    Object.keys(spotEls).forEach(function(k){
      var s=spotEls[k];
      tmp.copy(s.vec); droid.localToWorld(tmp); tmp.project(camera);
      if(tmp.z>1){ s.holder.style.display="none"; return; }
      s.holder.style.display="block";
      s.holder.style.transform="translate("+((tmp.x*0.5+0.5)*w).toFixed(1)+"px,"+((-tmp.y*0.5+0.5)*h).toFixed(1)+"px)";
    });
    Object.keys(AGENTS).forEach(function(id){
      var A=AGENTS[id];
      tmp.set(0, 4.8, 0); A.wrap.localToWorld(tmp); tmp.project(camera);
      if(tmp.z>1){ A.el.style.display="none"; return; }
      A.el.style.display="block";
      A.el.style.transform="translate("+((tmp.x*0.5+0.5)*w).toFixed(1)+"px,"+((-tmp.y*0.5+0.5)*h).toFixed(1)+"px)";
    });
  }

  /* ===================================================================
     8. EVENT TICKER
     =================================================================== */
  var ticker=document.getElementById("ticker");
  function hhmm(t){
    var d=new Date(t);
    return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")+":"+String(d.getSeconds()).padStart(2,"0");
  }
  function pushTick(ev, dim){
    var row=document.createElement("div");
    row.className="tick"+(ev.kind==="result" ? (ev.error?" err":" ok") : "")+(dim?" dim":"");
    var name = ev.kind==="tool" ? ev.tool
             : ev.kind==="result" ? (ev.error?"error":"ok")
             : ev.kind==="text" ? "text"
             : ev.kind==="user" ? "human turn"
             : ev.kind==="mode" ? ("mode: "+(ev.label||"?"))
             : ev.kind==="title" ? "title"
             : (ev.label||ev.kind);
    row.innerHTML='<span class="ts">'+hhmm(ev.t)+'</span><span class="nm">'+name+'</span>'+
                  (ev.agent?'<span class="sd">'+ev.agent+'</span>':(ev.sidechain?'<span class="sd">sub</span>':''));
    ticker.appendChild(row);
    while(ticker.children.length>9) ticker.removeChild(ticker.firstChild);
  }

  /* ===================================================================
     9. EVENT ROUTING
     =================================================================== */
  var flashTimers = {};

  function bump(m, id, amount){
    var e = m[id]; if(!e) return;
    e.p = Math.min(1.6, e.p + (amount||1));
    e.n++;
  }
  function fireRail(id){
    var b=railEls[id]; if(!b) return;
    b.dataset.fire="1";
    clearTimeout(flashTimers[id]);
    flashTimers[id]=setTimeout(function(){ b.dataset.fire="0"; }, 420);
    b.querySelector(".n").textContent = MOD[id].n > 999 ? "999+" : MOD[id].n;
  }

  function route(ev, m, r2){
    var id;
    if(ev.kind==="tool"){
      id = moduleFor(ev.tool);
      bump(m, id, 1);
      if(id==="sns" && r2) turnDome(r2, (Math.random()<0.5?-1:1)*(0.5+Math.random()*1.6));
      return id;
    }
    if(ev.kind==="result"){
      if(ev.error){ bump(m,"ext",1.2); return "ext"; }
      bump(m,"int",0.2); return "int";
    }
    if(ev.kind==="text"){ bump(m,"int",0.8); return "int"; }
    if(ev.kind==="user"){ bump(m,"loc",1); if(r2) turnDome(r2, -r2.domeTarget); return "loc"; }
    if(ev.kind==="mode"){ bump(m,"scp",0.7); return "scp"; }
    bump(m,"int",0.3); return "int";
  }

  function handle(ev, silent){
    live.events++;
    live.lastAt = Date.now();
    if(ev.model) live.model = ev.model;
    if(ev.tokens) live.tokens += ev.tokens;
    if(ev.sidechain) live.sidechains++;
    if(ev.kind==="tool") live.lastTool = ev.tool;
    if(ev.kind==="result" && ev.error) live.errors++;

    if(ev.agent && ev.kind==="tool" && ev.tool==="Task"){
      lastTask = { agent: ev.agent, at: Math.min(Date.now(), ev.t || Date.now()) };
    }

    if(ev.agent){
      var A = ensureAgent(ev.agent, ev.model, ev.t);
      if(!A){ if(!silent) pushTick(ev, false); return; }
      A.lastAt = Math.min(Date.now(), ev.t || Date.now());
      if(ev.atype) A.el.querySelector(".atype").textContent = ev.atype;
      // the model is only known once a model-bearing event arrives
      if(ev.model){
        var want = seriesFor(ev.model);
        if(want !== A.series) buildAgentBody(A, want);
      }
      if(ev.kind==="tool"){
        A.el.dataset.err="0";
        A.el.querySelector(".atool").textContent = ev.tool;
        if(!silent && moduleFor(ev.tool)==="trx")
          shock(A.wrap.position.x, 1.2, A.wrap.position.z, 0.2, 1.8, 0.9, false);
        A.r2.good = Math.max(A.r2.good, 0.5);
      } else if(ev.kind==="result"){
        if(ev.error){
          A.el.dataset.err="1"; A.r2.bad = 1;
          if(!silent) shock(A.wrap.position.x, 0.02, A.wrap.position.z, 0.3, 2.2, 0.8, true);
        } else {
          A.r2.good = 1;
        }
      }
      if(ev.kind==="tool") pendStart(A.pend, ev);
      else if(ev.kind==="result") pendEnd(A.pend, ev);
      route(ev, A.mod, A.r2);
      bump(MOD,"vck",0.10);
    } else {
      if(ev.kind==="tool") pendStart(mainPend, ev);
      else if(ev.kind==="result") pendEnd(mainPend, ev);
      if(ev.kind==="result"){ if(ev.error) MAIN.bad = 1; else MAIN.good = 1; }
      var rid = route(ev, MOD, MAIN);
      if(!silent){
        if(rid==="trx") shock(0, 3.9, 0, 0.4, 4.6, 1.1, false);
        if(rid==="ext") shock(0, 0.02, 0, 0.5, 5.2, 0.9, true);
      }
    }

    var railId = ev.kind==="tool" ? moduleFor(ev.tool)
               : ev.kind==="result" ? (ev.error?"ext":"int")
               : ev.kind==="text" ? "int"
               : ev.kind==="user" ? "loc"
               : ev.kind==="mode" ? "scp" : "int";
    if(ev.agent && MOD[railId]) MOD[railId].n++;
    fireRail(railId);

    if(!silent) pushTick(ev, false);
  }

  /* ===================================================================
     10. SESSION LINK
     =================================================================== */
  var sel=document.getElementById("sessions");
  var linkEl=document.getElementById("link");
  var linkText=document.getElementById("linktext");
  var es=null, retry=null;

  function setLink(state, text){ linkEl.dataset.on=state; linkText.textContent=text; }
  function rel(ms){
    var d=(Date.now()-ms)/1000;
    if(d<90) return "now";
    if(d<3600) return Math.round(d/60)+" min ago";
    if(d<86400) return Math.round(d/3600)+" h ago";
    return Math.round(d/86400)+" d ago";
  }
  function shortCwd(p){
    if(!p) return null;
    return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
  }
  function labelFor(s){
    var name = s.title || shortCwd(s.cwd) || s.id.slice(0,8);
    var where = shortCwd(s.cwd) || "";
    return name + (where && name!==where ? "  ·  "+where : "") + "  ·  " + rel(s.mtime);
  }
  function fillSelect(list, keep){
    sel.innerHTML="";
    list.forEach(function(s){
      var o=document.createElement("option");
      o.value=s.path; o.textContent=labelFor(s);
      sel.appendChild(o);
    });
    if(keep){
      sel.value=keep;
      if(sel.value!==keep && list.length) sel.value=list[0].path;
    }
  }

  function loadSessions(){
    fetch("/api/sessions?limit=40").then(function(r){ return r.json(); }).then(function(list){
      if(!list.length){
        sel.innerHTML="";
        var o=document.createElement("option");
        o.textContent="no sessions found";
        sel.appendChild(o);
        setLink("err","nothing to watch");
        return;
      }
      fillSelect(list);
      connect(list[0].path);
    }).catch(function(){ setLink("err","server unreachable"); });
  }

  function resetAll(){
    Object.keys(AGENTS).forEach(killAgent);
    MODKEYS.forEach(function(k){
      MOD[k].n=0; MOD[k].p=0;
      if(railEls[k]) railEls[k].querySelector(".n").textContent="0";
    });
    live.lastTool="—"; live.model="—"; live.tokens=0;
    live.errors=0; live.events=0; live.sidechains=0; live.lastAt=0;
    ticker.innerHTML="";
  }

  function connect(path){
    if(es){ es.close(); es=null; }
    clearTimeout(retry);
    resetAll();
    QUEUE.length = 0; qAcc = 0;
    mainPend = {};
    setLink("0","connecting…");

    es=new EventSource("/api/stream?path="+encodeURIComponent(path));
    es.addEventListener("backlog", function(e){
      var evs=JSON.parse(e.data);
      // only spawn droids for subagents that were still working at the end
      var lastByAgent={}, newest=0;
      evs.forEach(function(ev){
        if(ev.agent) lastByAgent[ev.agent]=Math.max(lastByAgent[ev.agent]||0, ev.t);
        if(ev.t>newest) newest=ev.t;
      });
      aliveFilter=new Set();
      Object.keys(lastByAgent).forEach(function(id){
        if(newest - lastByAgent[id] < AGENT_TTL) aliveFilter.add(id);
      });
      evs.forEach(function(ev){ handle(ev, true); });
      aliveFilter=null;
      evs.slice(-9).forEach(function(ev){ pushTick(ev, true); });
      MODKEYS.forEach(function(k){ MOD[k].p=0; });
      Object.keys(AGENTS).forEach(function(id){
        MODKEYS.forEach(function(k){ AGENTS[id].mod[k].p=0; });
      });
      renderReadout();
    });
    es.addEventListener("ready", function(){ setLink("1","listening"); });
    es.addEventListener("events", function(e){
      // queued, not fired: the loop paces them out
      QUEUE.push.apply(QUEUE, JSON.parse(e.data));
    });
    es.addEventListener("beat", function(){});
    es.onerror=function(){
      setLink("err","reconnecting…");
      if(es){ es.close(); es=null; }
      retry=setTimeout(function(){ connect(path); }, 3000);
    };
  }

  sel.addEventListener("change", function(){ connect(sel.value); });
  loadSessions();

  setInterval(function(){
    if(document.activeElement===sel) return;
    var keep=sel.value;
    fetch("/api/sessions?limit=40").then(function(r){return r.json();}).then(function(list){
      if(!list.length || !sel.options.length) return;
      if(list[0].path !== sel.options[0].value) fillSelect(list, keep);
    }).catch(function(){});
  }, 30000);

  /* ===================================================================
     11. CONSOLE
     =================================================================== */
  var btnRoam=document.getElementById("btn-roam");
  var btnShop=document.getElementById("btn-shop");
  var btnSpin=document.getElementById("btn-spin");
  var btnScan=document.getElementById("btn-scan");
  var btnReset=document.getElementById("btn-reset");
  var btnInfo=document.getElementById("btn-info");
  var scrim=document.getElementById("scrim");
  var alarmEl=document.getElementById("alarm");

  function syncRoam(){ btnRoam.setAttribute("aria-pressed", roamOn?"true":"false"); }
  btnRoam.addEventListener("click",function(){ roamOn=!roamOn; syncRoam(); });

  var shopOn = true;
  function syncShop(){
    btnShop.setAttribute("aria-pressed", shopOn?"true":"false");
    workshop.visible = shopOn;
  }
  btnShop.addEventListener("click",function(){ shopOn=!shopOn; syncShop(); });

  function syncSpin(){ btnSpin.setAttribute("aria-pressed", autoSpin?"true":"false"); }
  btnSpin.addEventListener("click",function(){ autoSpin=!autoSpin; syncSpin(); });

  var scanOn=!reduce;
  function syncScan(){
    btnScan.setAttribute("aria-pressed",scanOn?"true":"false");
    uniforms.uScan.value=scanOn?1:0;
    scanRing.visible=scanOn;
  }
  btnScan.addEventListener("click",function(){ scanOn=!scanOn; syncScan(); });
  btnReset.addEventListener("click",function(){
    cam.theta=HOME.theta; cam.phi=HOME.phi; cam.radius=HOME.radius; applyCamera();
  });
  btnInfo.addEventListener("click",function(){
    scrim.dataset.open="1"; document.getElementById("info-close").focus();
  });
  document.getElementById("info-close").addEventListener("click",function(){
    scrim.dataset.open="0"; btnInfo.focus();
  });
  scrim.addEventListener("click",function(e){ if(e.target===scrim) scrim.dataset.open="0"; });
  document.addEventListener("keydown",function(e){
    if(e.key==="Escape" && scrim.dataset.open==="1") scrim.dataset.open="0";
  });

  /* ===================================================================
     12. LOOP
     =================================================================== */
  function resize(){
    var w=stage.clientWidth||window.innerWidth, h=stage.clientHeight||window.innerHeight;
    renderer.setSize(w,h);   // updateStyle on: without it a Retina canvas
    camera.aspect=w/h;       // is sized twice as large as its stage
    camera.updateProjectionMatrix();
    return [w,h];
  }
  var size=resize();
  window.addEventListener("resize",function(){ size=resize(); });

  applyCamera(); select(SYSTEMS[0].id); syncRoam(); syncShop(); syncSpin(); syncScan();
  markShared();

  var clock=new THREE.Clock();
  var beamTarget=new THREE.Vector3(), tmpVec=new THREE.Vector3();

  /* The poll delivers a batch every 1.2 s, so firing them all on one frame
     produces a spike followed by dead air. Spreading the batch across the
     interval turns it back into a sequence you can actually read. */
  var QUEUE=[], qAcc=0;
  function drainQueue(dt){
    if(!QUEUE.length) return;
    qAcc += dt;
    var step = clamp(1.1/QUEUE.length, 0.06, 0.30);
    var guard = 0;
    while(QUEUE.length && qAcc >= step && guard++ < 24){
      handle(QUEUE.shift(), false);
      qAcc -= step;
      step = clamp(1.1/Math.max(1,QUEUE.length), 0.06, 0.30);
    }
    renderReadout();
  }

  function frame(){
    requestAnimationFrame(frame);
    // ORDER MATTERS: getElapsedTime() consumes the delta internally, so a
    // getDelta() called after it returns ~0 and everything time-based
    // freezes. Delta first, then read elapsedTime.
    var dt=Math.min(0.05, clock.getDelta());
    var t=clock.elapsedTime;
    var nowMs=Date.now();
    uniforms.uTime.value=t;

    if(autoSpin){ cam.theta += 0.10*dt; }

    drainQueue(dt);

    var decay = Math.exp(-1.9*dt);
    MODKEYS.forEach(function(k){ MOD[k].p *= decay; });

    /* Three states, and only one of them is actually "nothing happening":
       a call in flight, a wait on the model, or a truly idle session. */
    var inflight = applyPending(mainPend, MOD);
    var sinceLast = nowMs - (live.lastAt || 0);
    var waiting = !inflight && live.lastAt && sinceLast < WAIT_WINDOW;
    if(waiting) MOD.int.p = Math.max(MOD.int.p, 0.20);
    var idle = !inflight && !waiting;

    var ex = animateDroid(MAIN, MOD, t, dt, idle);

    /* --- patrol: pick a spot, roll to it, park in the middle when idle --- */
    if(roamOn && !idle){
      roam.next -= dt;
      if(roam.next <= 0){
        var ra = Math.random()*Math.PI*2, rr = 0.9 + Math.random()*2.5;
        roam.target.set(Math.cos(ra)*rr, 0, Math.sin(ra)*rr);
        roam.next = 6 + Math.random()*9;
      }
    } else {
      roam.target.set(0,0,0);
    }
    var pX = roam.pos.x, pZ = roam.pos.z;
    roam.pos.x = damp(roam.pos.x, roam.target.x, 0.85, dt);
    roam.pos.z = damp(roam.pos.z, roam.target.z, 0.85, dt);
    var vx = (roam.pos.x - pX)/Math.max(dt,1e-4);
    var vz = (roam.pos.z - pZ)/Math.max(dt,1e-4);
    roam.speed = Math.sqrt(vx*vx + vz*vz);
    var turn = 0;
    if(roam.speed > 0.06){
      var want = Math.atan2(vx, vz);
      turn = ((want - roam.heading + Math.PI*3) % (Math.PI*2)) - Math.PI;
      roam.heading += turn * (1 - Math.exp(-5*dt));
    }
    roam.bank = damp(roam.bank, clamp(-turn*1.6, -0.12, 0.12), 6, dt);

    droid.position.set(
      roam.pos.x + MAIN.shake.x,
      Math.abs(Math.sin(t*7)) * 0.018 * Math.min(1, roam.speed),
      roam.pos.z + MAIN.shake.z
    );
    droid.rotation.y = roam.heading;
    droid.rotation.z = roam.bank;

    // keep him loosely framed instead of letting him wander out of shot
    cam.target.x = damp(cam.target.x, roam.pos.x*0.65, 1.6, dt);
    cam.target.z = damp(cam.target.z, roam.pos.z*0.65, 1.6, dt);
    applyCamera();

    alarmEl.style.opacity = (ex*0.45).toFixed(3);

    /* --- subagent droids --- */
    var ids = Object.keys(AGENTS);
    var newest = null, newestT = 0;
    for(var ai=0; ai<ids.length; ai++){
      var A=AGENTS[ids[ai]];
      MODKEYS.forEach(function(k){ A.mod[k].p *= decay; });
      var aFlight = applyPending(A.pend, A.mod);
      var aIdle = !aFlight && (nowMs - A.lastAt) > 15000;
      if(aFlight){
        var secs = Math.round((nowMs - aFlight.at)/1000);
        A.el.querySelector(".atool").textContent =
          aFlight.tool + (secs > 2 ? "  " + secs + "s" : "");
      }
      animateDroid(A.r2, A.mod, t, dt, aIdle);
      A.r2.group.position.set(A.r2.shake.x, 0, A.r2.shake.z);

      if(nowMs - A.lastAt > AGENT_TTL) A.dying = true;

      if(!A.dying){
        A.t = Math.min(1, A.t + dt*1.7);
        A.wrap.scale.setScalar(A.targetScale * easeOutBack(A.t));
        // materialisation wipe: a glowing front climbs the body
        A.clipT = Math.min(1.35, A.clipT + dt*0.9);
        var h = (A.r2.topY + 3.6) * A.targetScale;
        A.r2.mats.hull.uniforms.uClipY.value =
          A.clipT >= 1.3 ? NOCLIP : A.wrap.position.y + A.clipT*h*1.15;
        var lf = Math.min(1, A.clipT*1.4);
        A.r2.mats.line.opacity  = A.r2.mats.line.userData.base * lf;
        A.r2.mats.faint.opacity = A.r2.mats.faint.userData.base * lf;
      } else {
        A.wrap.scale.setScalar(damp(A.wrap.scale.x, 0, 4.5, dt));
      }
      A.el.style.opacity = Math.min(1, A.wrap.scale.x/(A.targetScale*0.72)).toFixed(2);

      // faint tether from the projector: it is holding them up
      if(!A.tether){
        var tg=new THREE.BufferGeometry();
        tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6),3));
        A.tether=new THREE.Line(tg, lineMaterial(PROJ,0.10));
        scene.add(A.tether);
      }
      var tp=A.tether.geometry.attributes.position;
      var P = A.parent && AGENTS[A.parent];
      if(P){
        tmpVec.set(-0.34, 3.5, 0.5);
        P.wrap.localToWorld(tmpVec);
      } else if(MAIN.beam){
        MAIN.beam.getWorldPosition(tmpVec);
      } else {
        tmpVec.set(0,3.5,0);
      }
      tp.setXYZ(0, tmpVec.x, tmpVec.y, tmpVec.z);
      tp.setXYZ(1, A.wrap.position.x, 2.2*A.wrap.scale.x, A.wrap.position.z);
      tp.needsUpdate = true;
      A.tether.material.opacity = (0.05 + 0.10*A.mod.int.p + 0.10*Math.max(0,Math.sin(t*2+A.slot))) * Math.min(1,A.wrap.scale.x/A.targetScale);

      if(A.lastAt > newestT){ newestT = A.lastAt; newest = A; }
      if(A.dying && A.wrap.scale.x < 0.02) killAgent(ids[ai]);
    }

    /* --- the VicksVisc beam aims at whichever droid worked last --- */
    if(MAIN.beam){
      var want = newest && (nowMs - newestT) < 12000;
      var op = want ? Math.min(0.20, 0.07 + MOD.vck.p*0.22) : 0;
      MAIN.beamMat.opacity = damp(MAIN.beamMat.opacity, op, 6, dt);
      MAIN.beam.visible = MAIN.beamMat.opacity > 0.01;
      if(MAIN.beam.visible && newest){
        beamTarget.set(0, 2.2*newest.wrap.scale.x/newest.targetScale, 0);
        newest.wrap.localToWorld(beamTarget);
        MAIN.beam.lookAt(beamTarget);
        var d = MAIN.beam.getWorldPosition(tmpVec).distanceTo(beamTarget);
        MAIN.beam.scale.set(1, 1, Math.max(0.4, d));
      }
    }

    /* --- ground shockwaves --- */
    for(var wi=0; wi<WAVES.length; wi++){
      var W=WAVES[wi];
      if(W.life<=0){ W.obj.visible=false; continue; }
      W.life -= dt/W.dur;
      var k2 = 1-Math.max(0,W.life);
      var e = 1-Math.pow(1-k2,3);
      W.obj.scale.setScalar(W.r0 + (W.r1-W.r0)*e);
      W.mat.opacity = Math.max(0, (1-e)*0.55);
    }

    if(shopOn && !reduce){
      var W = workshop.userData;
      var slide = Math.sin(t*0.16)*5.0;
      W.trolley.position.x = slide;
      W.hook.position.x = slide;
      W.hook.position.y = -2.85 + Math.sin(t*0.5)*0.18;
      W.hook.rotation.y = t*0.25;
      var busy = Math.min(1, MOD.scp.p + MOD.man.p + MOD.sns.p + MOD.int.p*0.5);
      var st = inflight
        ? { head:"RUNNING", label:inflight.tool, secs:Math.round((nowMs-inflight.at)/1000), mode:"run" }
        : waiting
        ? { head:"WAITING ON MODEL", label:live.lastTool, secs:Math.round(sinceLast/1000), mode:"wait" }
        : { head:"IDLE", label:live.lastTool, secs:0, mode:"idle" };
      W.monitor.tick(dt, st, busy, live.events, live.errors);
    }

    if(scanOn){
      var span=7.5;
      scanRing.position.y=(t*1.5)%span;
      scanRing.material.opacity=0.42*(1-((t*1.5)%span)/span);
    }
    gridGroup.rotation.y = t*0.018;

    updateSpots(size[0],size[1]);
    renderer.render(scene,camera);
  }
  frame();
})();
