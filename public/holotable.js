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
    events:0, lastAt:0, sidechains:0,
    // session-wide signals the transcript hands over for free
    cache:0, fresh:0,            // context reused vs context paid for again
    effort:"—", speed:"—",
    perm:"—",                    // permission mode in force
    files:0, lastFile:"—",       // footprint on the bench
    queue:0,                     // messages waiting to be sent
    turns:0, turnMs:0,           // closed turns and the last one's length
    cost:null                    // the latest cost-state digest
  };
  /* Cache reads are almost free, fresh input is what the bill is made of.
     The ratio drives the projector beam's colour, so an expensive stretch
     is visible before the ledger catches up with it. */
  function cacheRatio(){
    var tot = live.cache + live.fresh;
    return tot > 0 ? live.cache/tot : 1;
  }

  /* A session is bursty by nature: a tool fires, then nothing happens for
     thirty seconds while the command runs or the model thinks. Decaying to
     idle after two seconds makes that look like a dead scene. So calls in
     flight are tracked, and the droid holds its working pose for as long as
     the call actually lasts — which is the truth, not filler. */
  var mainPend = {};
  var mainProps = { props:{} };
  var pendSeq = 0;
  // Two honest signals for "waiting on a human": an AskUserQuestion /
  // ExitPlanMode call still open, or a turn that has closed with no human
  // turn after it. Anything else would be guesswork.
  var ASK_TOOLS = /^(AskUserQuestion|ExitPlanMode)$/;
  var mainTurnEnded = false;
  /* The transcript marks a context compaction with a system line of subtype
     compact_boundary. It is a marker, not a span — the compaction has already
     happened by the time it lands — so the droid docks for a fixed stretch to
     make the event visible rather than pretending to measure it. */
  var CHARGE_MS = 15000;
  var chargeUntil = 0;
  /* Talking is a span, not an event: prose arrives one block at a time, so
     each text block holds the pose for a few seconds and the stream of them
     keeps it up for the whole answer. */
  var TALK_MS = 5000;
  var talkUntil = 0, talkAmt = 0, thinkAmt = 0;
  var SLEEP_AFTER = 10 * 60 * 1000, sleepAmt = 0;
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
  function isAsk(pend){
    var keys = Object.keys(pend);
    for(var i=0;i<keys.length;i++) if(ASK_TOOLS.test(pend[keys[i]].tool)) return true;
    return false;
  }
  /* red > blue > amber > green; nothing lit while a call is running */
  function setLamps(r2, st, dt){
    var want = { idle:0, wait:0, ask:0, err:0 };
    if(st.err) want.err = 1;
    else if(st.ask) want.ask = 1;
    else if(st.wait) want.wait = 1;
    else if(st.idle) want.idle = 1;
    ["idle","wait","ask","err"].forEach(function(k){
      r2.lamp[k] = damp(r2.lamp[k], want[k], 7, dt);
    });
  }

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
  scene.fog = new THREE.FogExp2(0x03070e, 0.0085);
  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);

  // No WebGL (old browser, hardware acceleration off, headless): say so
  // instead of leaving a blank stage and an exception in the console.
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({antialias:true, alpha:true,
                                        preserveDrawingBuffer:true});
  } catch(e){
    stage.innerHTML = '<div style="padding:2rem;color:#9df2ff;font:14px/1.6 system-ui">'+
      '<strong>WebGL is not available in this browser.</strong><br>'+
      'The holotable needs it to draw. Check that hardware acceleration is on '+
      '(chrome://gpu), or try another browser.</div>';
    return;
  }
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
    function blipMesh(parent, color, pos, r, ry){
      var mm = new THREE.MeshBasicMaterial({
        color:color, transparent:true, opacity:0.07,
        blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide
      });
      var d = new THREE.Mesh(geom("blip"+r, function(){
        return new THREE.CircleGeometry(r, 14);
      }), mm);
      d.position.set(pos[0],pos[1],pos[2]);
      d.rotation.y = ry || 0;
      parent.add(d);
      // halo: a wide faint disc behind the lamp so lit states carry across
      // the room instead of reading as a pinprick
      var hm = new THREE.MeshBasicMaterial({
        color:color, transparent:true, opacity:0,
        blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide
      });
      var h = new THREE.Mesh(geom("blipH"+r, function(){
        return new THREE.CircleGeometry(r*2.8, 14);
      }), hm);
      var nx = Math.sin(ry || 0), nz = Math.cos(ry || 0);
      h.position.set(pos[0]-nx*0.006, pos[1], pos[2]-nz*0.006);
      h.rotation.y = ry || 0;
      parent.add(h);
      mm.userData.halo = hm;
      return mm;
    }
    /* Status cluster on the dome. One lamp lit at a time, each colour with
       exactly one meaning:
         green  idle, nothing to do      blue  waiting on a human
         amber  waiting on the model     red   something failed
       While a call is actually running no lamp is lit — the callout and the
       rig itself already say so. While the model is thinking with no call
       open, a fast chase runs across the whole row on top of the settled
       levels: amber stays dominant, but the head reads as busy. */
    /* Two lamp rows on opposite flanks, sitting on the surface and facing
       outward — the old front row sat inside the hull (radius 0.74 against
       a 0.89 surface) and read as nothing. Left row: idle, wait; right
       row: ask, err. Sizes per head so every series wears them on the skin. */
    var lampY = 0.30, lampR = 0.87;
    if(headKind === "cone"){ lampY = 0.30; lampR = 0.675; }
    else if(headKind !== "dome"){ lampY = 0.22; lampR = 0.62; }
    function flank(a){ return [Math.sin(a)*lampR, lampY, Math.cos(a)*lampR]; }
    var lamps = {
      idle: blipMesh(dome, GOOD,     flank(-0.68), 0.062, -0.68),
      wait: blipMesh(dome, 0xffb454, flank(-0.96), 0.062, -0.96),
      ask:  blipMesh(dome, 0x6fa8ff, flank( 0.68), 0.062,  0.68),
      err:  blipMesh(dome, BAD,      flank( 0.96), 0.062,  0.96)
    };
    // the body logic display stays a neutral activity chase
    var logic = [];
    for(var li=0; li<4; li++){
      logic.push(blipMesh(squash, 0x5fe3ff, [-0.21 + li*0.14, 2.32, 0.95], 0.035));
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
      lamps:lamps, lamp:{idle:0, wait:0, ask:0, err:0}, logic:logic, good:0, bad:0,
      centerLeg:centerLeg, feet:FEET, beam:beam, beamMat:beamMat, topY:topY,
      sparkPos:sparkPos, sparkVel:sparkVel, sparkLife:sparkLife,
      sparkGeo:sparkGeo, sparkMat:sparkMat, SPARK_N:SPARK_N,
      workPhase:Math.random()*6, gest:null, gestT:0, nextGest:4+Math.random()*8,
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
  function animateDroid(r2, m, t, dt, idle, talk, think){
    talk = talk || 0;
    think = think || 0;
    // while talking the head scans instead of settling: R2 thinking out loud
    if(talk > 0.01 && !reduce) r2.domeTarget += talk * dt * 1.7;
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
    /* A call in flight holds its module up for its whole duration. Held at a
       constant value that renders as a frozen pose, which is worse than
       nothing — so engagement drives a CYCLE: the arm pumps, the dome sweeps,
       the manipulator strokes. The phase runs faster the busier it is. */
    r2.workPhase += dt * (1.0 + (m.scp.p + m.man.p + m.sns.p) * 1.9);
    var ph = r2.workPhase;

    var k = 78 + m.sns.p*60, c = 10.5;
    r2.domeVel += (-(r2.domeCur - r2.domeTarget)*k - r2.domeVel*c) * dt;
    r2.domeCur += r2.domeVel * dt;
    // while scanning, the dome sweeps an arc on top of its settled angle
    var scanAmp = Math.min(0.5, m.sns.p*0.46);
    r2.dome.rotation.y = r2.domeCur + Math.sin(ph*2.4)*scanAmp;
    r2.dome.rotation.z = damp(r2.dome.rotation.z, clamp(-r2.domeVel*0.016,-0.12,0.12), 9, dt);
    // thinking reads as small considering tilts, not stillness
    r2.dome.rotation.x = damp(r2.dome.rotation.x, Math.sin(ph*0.9)*0.07*Math.min(1,m.int.p), 6, dt);

    /* --- antennas lag behind: secondary motion is what sells a rig --- */
    var antT = clamp(-r2.domeVel*0.030, -0.45, 0.45) + Math.sin(ph*7.0)*0.14*Math.min(1,m.trx.p)
               + Math.sin(ph*9.0)*0.12*talk;
    r2.antVel += (-(r2.antAng - antT)*150 - r2.antVel*8) * dt;
    r2.antAng += r2.antVel * dt;
    r2.antennas.rotation.z = r2.antAng;
    r2.antennas.rotation.x = r2.antAng*0.35;

    /* --- eye: level plus an occasional blink --- */
    r2.nextBlink -= dt;
    if(r2.nextBlink <= 0){ r2.blink = 1; r2.nextBlink = 2.5 + Math.random()*6; }
    r2.blink = Math.max(0, r2.blink - dt*7);
    var eyeBase = 0.30 + m.sns.p*0.60 + (idle?0:0.10);
    // speaking warble on the eye while talking
    var warble = 1 - talk*0.28*(0.5+0.5*Math.sin(t*23));
    r2.eyeMat.opacity = Math.max(0.04, eyeBase * (1 - r2.blink*0.9) * warble);

    /* --- logic display: a green blip on a clean result, red on a failure,
       plus a slow idle chase so the row never looks dead --- */
    r2.good = Math.max(0, r2.good - dt*2.2);
    r2.bad  = Math.max(0, r2.bad  - dt*2.2);
    // each lamp breathes at its own rate: idle slow, error urgent
    var breathe = { idle:1.1, wait:3.1, ask:2.2, err:7.0 };
    ["idle","wait","ask","err"].forEach(function(kk, ki){
      var lm = r2.lamps[kk];
      var lv = r2.lamp[kk];
      // thinking chase: while the model works with no call open, the whole
      // row runs a fast random chase over the settled levels, so amber stays
      // dominant (still "waiting on the model") but the head reads as busy
      var flick = 0;
      if(think > 0.01 && !reduce){
        flick = think * Math.max(0, Math.sin(t*11 - ki*1.7)) * (0.35 + Math.random()*0.45);
      }
      var lop = 0.05 + Math.min(1, lv + flick) * (0.65 + 0.55*(0.5+0.5*Math.sin(t*breathe[kk])));
      lm.opacity = Math.min(1, lop);
      lm.userData.halo.opacity = Math.min(1, lop) * 0.38;
    });
    var actLvl = Math.min(1, r2.good + r2.bad + m.scp.p + m.man.p + talk*0.8);
    for(var bi=0; bi<r2.logic.length; bi++){
      var chase = Math.max(0, Math.sin(t*2.6 - bi*0.9));
      var bop = 0.05 + chase*(0.12 + actLvl*0.55);
      r2.logic[bi].opacity = Math.min(1, bop);
      r2.logic[bi].userData.halo.opacity = Math.min(1, bop) * 0.35;
    }

    /* --- weight: the body leans toward the working arm and dips as an
       action starts. Both pivot at the ground, so the feet stay put. --- */
    var leanT = (m.scp.p*0.050) - (m.man.p*0.050);
    r2.lean = damp(r2.lean, clamp(leanT,-0.07,0.07), 7, dt);
    // gentle sway while talking or thinking: reads at a glance, and tells a
    // dead rig apart from subtle lamps when diagnosing by eye
    var sway = reduce ? 0 : Math.sin(ph*1.7)*0.025*Math.max(talk, think);
    r2.group.rotation.z = r2.lean + sway;

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
    var stroke = 0.5 + 0.5*Math.sin(ph*4.1);                 // pumping stroke
    var scT = 0.90 + easeOutBack(Math.min(1,sc*1.25))*(0.16 + stroke*0.20);
    r2.scomp.position.z = damp(r2.scomp.position.z, sc>0.03?scT:0.90, sc>0.03?22:6, dt);
    r2.scomp.rotation.x = Math.sin(ph*4.1 + 0.6)*0.10*sc;
    r2.scompArm.mesh.rotation.z += sc*(14 + stroke*18)*dt;
    r2.scompArm.lines.rotation.z = r2.scompArm.mesh.rotation.z;

    /* --- manipulator: short extension and a fine tremor --- */
    var mn = Math.min(1, m.man.p);
    var poke = 0.5 + 0.5*Math.sin(ph*5.6);                   // short repeated strokes
    r2.manip.position.z = damp(r2.manip.position.z, 0.90 + mn*(0.10 + poke*0.18), mn>0.03?24:6, dt);
    r2.manip.rotation.z = Math.sin(ph*17)*0.05*mn;
    r2.manip.rotation.x = Math.sin(ph*12+1.3)*0.05*mn;

    /* --- sparks fly off whichever tool is active --- */
    var weld = Math.max(m.scp.p, m.man.p*0.75);
    r2.sparkMat.opacity = Math.min(0.9, 0.35 + weld*0.6);
    var onScomp = m.scp.p >= m.man.p;
    var ox = onScomp ?  0.30 : -0.30;
    var oy = onScomp ?  2.05 :  1.78;
    var oz = onScomp ?  1.66 :  1.54;
    var burst = Math.max(0, Math.sin(ph*4.1));               // fires on the stroke
    var budget = weld > 0.05 ? Math.ceil(weld*7*burst*burst) : 0;
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

    /* --- idle is not stillness: every few seconds the droid does something
       small. Staggered per droid so a group never moves in unison. --- */
    if(idle && !reduce){
      r2.nextGest -= dt;
      if(r2.nextGest <= 0){
        r2.gest = ["rock","peek","stretch","settle"][(Math.random()*4)|0];
        r2.gestT = 0;
        r2.nextGest = 5 + Math.random()*11;
      }
    }
    if(r2.gest){
      r2.gestT += dt;
      var gp = r2.gestT;
      if(r2.gest === "rock"){
        r2.group.rotation.z += Math.sin(gp*5.0)*0.035*Math.max(0,1-gp/1.6);
      } else if(r2.gest === "peek"){
        if(gp < 0.05) turnDome(r2, (Math.random()<0.5?-1:1)*(0.8+Math.random()*0.9));
        r2.dome.rotation.x += Math.sin(gp*3.2)*0.08*Math.max(0,1-gp/1.8);
      } else if(r2.gest === "stretch"){
        var e2 = Math.sin(Math.min(1,gp/1.4)*Math.PI);
        r2.scomp.position.z += e2*0.26;
        r2.scompArm.mesh.rotation.z += e2*4*dt*10;
        r2.scompArm.lines.rotation.z = r2.scompArm.mesh.rotation.z;
      } else if(r2.gest === "settle"){
        r2.squash.scale.y *= 1 - Math.sin(Math.min(1,gp/1.2)*Math.PI)*0.04;
      }
      if(r2.gestT > 1.9) r2.gest = null;
    }

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
    var anchor = null;
    if(parentId){
      var P = AGENTS[parentId];
      P.kids = (P.kids || 0) + 1;
      var ca = (P.kids-1) * 1.25 + 0.6;
      var cr = 4.0 * (P.targetScale/0.52);
      anchor = new THREE.Vector3(Math.cos(ca)*cr, 0, Math.sin(ca)*cr); // vs parent
      wrap.position.set(P.wrap.position.x + anchor.x, 0,
                        P.wrap.position.z + anchor.z);
      wrap.rotation.y = -Math.atan2(P.wrap.position.z - wrap.position.z,
                                    P.wrap.position.x - wrap.position.x) + Math.PI/2;
    } else {
      var ang = (slot/SLOTS)*Math.PI*2 + 0.35;
      var R = 9.8;
      wrap.position.set(Math.cos(ang)*R, 0, Math.sin(ang)*R);
      wrap.rotation.y = -ang + Math.PI/2;      // face the centre
      anchor = wrap.position.clone();          // absolute home
    }
    wrap.scale.setScalar(0.001);
    scene.add(wrap);

    var el = document.createElement("div");
    el.className = "agent-tag";
    el.innerHTML = '<span class="head"><span class="aser">R2</span>'+
                   '<span class="aid">'+id+'</span><span class="atype"></span></span>'+
                   '<span class="what">—</span><span class="secs"></span>';
    if(parentId) el.dataset.child = "1";
    agentsLayer.appendChild(el);

    var A = { id:id, wrap:wrap, r2:null, mod:newMod(), lastAt:evTime||Date.now(),
              slot:slot, el:el, dying:false, t:0, clipT:0, kids:0,
              parent:parentId, series:null, targetScale:0.42, pend:{},
              anchor:anchor, woff:new THREE.Vector3(), rnext:1+Math.random()*4,
              atStation:false,
              hd:wrap.rotation.y, props:{},
              model:null, atype:null, lastTool:"—", tokens:0, tools:0,
              errors:0, firstAt:Date.now(), mode:"idle", secs:0 };
    el.addEventListener("click", function(){ showAgent(id); });
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
    Object.keys(A.props||{}).forEach(function(k){
      var P=A.props[k]; scene.remove(P.group);
      P.group.traverse(function(o){ if(o.geometry) o.geometry.dispose(); if(o.material) o.material.dispose(); });
    });
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
    [3,6,9,12,15,18,21].forEach(function(r){
      var seg=72;
      for(var i=0;i<seg;i++){
        var a0=(i/seg)*Math.PI*2,a1=((i+1)/seg)*Math.PI*2;
        pts.push(Math.cos(a0)*r,0,Math.sin(a0)*r, Math.cos(a1)*r,0,Math.sin(a1)*r);
      }
    });
    for(var k=0;k<16;k++){
      var a=(k/16)*Math.PI*2;
      pts.push(Math.cos(a)*3,0,Math.sin(a)*3, Math.cos(a)*21,0,Math.sin(a)*21);
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
    var pts=[],seg=96,r=13;
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
      var r=6+Math.random()*32,a=Math.random()*Math.PI*2;
      arr[i*3]=Math.cos(a)*r; arr[i*3+1]=Math.random()*14; arr[i*3+2]=Math.sin(a)*r;
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
  var PICKS = [];

  (function buildWorkshop(){
    // Dimmer than the droids, but not so dim the bay disappears into fog.
    var wLine  = lineMaterial(PROJ, 0.30);
    var wFaint = lineMaterial(PROJ, 0.16);
    var wWarm  = lineMaterial(AMBER, 0.20);
    workshop.scale.setScalar(1.0);    // full-size bay: it was getting cramped

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
      var pts=[], w=11.0, d=7.6, x0=-w/2, z0=-d/2;
      [[x0,z0,x0+w,z0],[x0+w,z0,x0+w,z0+d],[x0+w,z0+d,x0,z0+d],[x0,z0+d,x0,z0]]
        .forEach(function(e){ pts.push(e[0],0.01,e[1], e[2],0.01,e[3]); });
      for(var i=1;i<10;i++){
        var x=x0+(w/10)*i;
        pts.push(x,0.01,z0, x-0.5,0.01,z0+0.5);
      }
      var g=new THREE.BufferGeometry();
      g.setAttribute("position",new THREE.Float32BufferAttribute(pts,3));
      var o=new THREE.LineSegments(g,wWarm);
      o.position.set(0,0,-13.5);
      workshop.add(o);
    })();

    // workbench with a tool rack
    var bench = new THREE.Group();
    bench.position.set(-13.0, 0, -3.0);
    bench.rotation.y = 0.9;
    workshop.add(bench);
    addBox(bench, 6.2, 0.18, 2.0, [0, 1.05, 0]);
    [-2.8, 2.8].forEach(function(x){
      addBox(bench, 0.18, 1.05, 1.8, [x, 0.52, 0], 0, wFaint);
    });
    addBox(bench, 6.2, 1.3, 0.09, [0, 2.4, -0.85], 0, wFaint);
    for(var ti=0; ti<7; ti++){
      var tool=new THREE.LineSegments(boxLines(0.08, 0.6 + (ti%3)*0.26, 0.08), wLine);
      tool.position.set(-2.4 + ti*0.8, 2.2 - (ti%3)*0.12, -0.72);
      bench.add(tool);
    }

    /* Session footprint. Every file the transcript records as edited leaves a
       tile on the bench, and the tile brightens each time that file is touched
       again. It is the only thing in the bay that PERSISTS: after an hour it
       is a map of where the work actually went, not a momentary flash. */
    var TILES = (function(){
      var slots = [], order = [], byPath = {};
      var COLS = 8, ROWS = 3;
      for(var r=0; r<ROWS; r++) for(var c=0; c<COLS; c++){
        var m = lineMaterial(PROJ, 0);
        var o = new THREE.LineSegments(boxLines(0.56, 0.06, 0.34), m);
        o.position.set(-2.45 + c*0.70, 1.20, 0.55 - r*0.40);
        o.visible = false;
        bench.add(o);
        slots.push({obj:o, mat:m, lit:0, rest:0, n:0, path:null});
      }
      return {
        touch: function(path){
          var s = byPath[path];
          if(!s){
            if(order.length >= slots.length){        // oldest tile is recycled
              s = order.shift();
              delete byPath[s.path];
              s.n = 0;
            } else {
              s = slots[order.length];
            }
            s.path = path;
            byPath[path] = s;
            order.push(s);
            s.obj.visible = true;
          }
          s.n++;
          s.lit = 1;
          s.rest = Math.min(0.50, 0.14 + s.n*0.045);   // hot files stay brighter
          return s;
        },
        count: function(){ return order.length; },
        tick: function(dt){
          for(var i=0; i<order.length; i++){
            var s = order[i];
            s.lit = damp(s.lit, 0, 1.7, dt);
            s.mat.opacity = s.rest + s.lit*0.80;
            s.obj.scale.y = 1 + s.lit*2.2;
          }
        }
      };
    })();

    // parts crates
    [[12.5,-5.2,0.5],[13.8,-2.2,-0.3],[11.2,-7.8,1.1],[13.2,-8.6,0.2]].forEach(function(c,i){
      addBox(workshop, 1.5, 1.5, 1.5, [c[0], 0.75, c[1]], c[2], i===1?wFaint:wLine);
    });
    addBox(workshop, 1.5, 1.5, 1.5, [12.5, 2.25, -5.2], 0.5, wFaint);

    // overhead gantry with a hook on a cable
    var gantry = new THREE.Group();
    gantry.position.y = 17.0;      // well clear of the sightlines, not overhead
    workshop.add(gantry);
    [-5.5, 5.5].forEach(function(z){
      var r=new THREE.LineSegments(boxLines(30, 0.2, 0.2), wLine);
      r.position.set(0, 0, z);
      gantry.add(r);
    });
    var trolley = new THREE.LineSegments(boxLines(1.3, 0.55, 11.4), wLine);
    gantry.add(trolley);
    var cg=new THREE.BufferGeometry();
    cg.setAttribute("position", new THREE.Float32BufferAttribute([0,0,0, 0,-2.6,0],3));
    var cable=new THREE.Line(cg, wFaint);
    gantry.add(cable);
    var hook = new THREE.LineSegments(boxLines(0.5,0.5,0.5), wLine);
    hook.position.y = -2.85;
    gantry.add(hook);

    // corner pylons
    [[-15.5,-15.5],[15.5,-15.5],[-15.5,15.5],[15.5,15.5],
     [0,-16.5],[0,16.5],[-16.5,0],[16.5,0]].forEach(function(c){
      addBox(workshop, 0.42, 18.4, 0.42, [c[0], 9.2, c[1]], 0, wFaint);
    });

    // diagnostic screen on a stand
    var screen = new THREE.Group();
    screen.position.set(4.5, 0, -13.0);
    screen.rotation.y = -0.35;
    workshop.add(screen);
    addBox(screen, 0.24, 2.4, 0.24, [0, 1.2, 0], 0, wFaint);
    addBox(screen, 3.6, 2.2, 0.12, [0, 3.4, 0]);
    // The screen is a real canvas: the last tool in plain type over a
    // glyph rain whose speed tracks how busy the session is.
    var monitor = (function(){
      var cv = document.createElement("canvas");
      cv.width = 512; cv.height = 256;      // a band, not a panel: it wraps
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
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.x = 3;                     // the readout reads from any side
      var mat = new THREE.MeshBasicMaterial({
        map:tex, transparent:true, opacity:0.30,   // a haze, not a wall
        blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide
      });
      // A holo column at the heart of the bay, with the droids working
      // around it. Open-ended and translucent, so it never blocks a sightline.
      // Taller than the room and lifted off the floor: droids pass underneath
      // and the sightline at droid height stays clear.
      var COL_R = 1.7, COL_H = 9.5, COL_BASE = 5.2;
      var column = new THREE.Group();
      column.position.set(0, COL_BASE, 0);
      scene.add(column);                    // outside the workshop: always on
      var band = new THREE.Mesh(
        new THREE.CylinderGeometry(COL_R, COL_R, COL_H, 40, 1, true), mat);
      band.position.y = COL_H/2;
      column.add(band);
      (function(){                          // cap rings and a few uprights
        var pts=[], seg=48;
        [0.02, COL_H*0.5, COL_H].forEach(function(y){
          for(var i=0;i<seg;i++){
            var a0=(i/seg)*Math.PI*2, a1=((i+1)/seg)*Math.PI*2;
            pts.push(Math.cos(a0)*COL_R, y, Math.sin(a0)*COL_R,
                     Math.cos(a1)*COL_R, y, Math.sin(a1)*COL_R);
          }
        });
        for(var u=0;u<8;u++){
          var ua=(u/8)*Math.PI*2;
          pts.push(Math.cos(ua)*COL_R, 0.02, Math.sin(ua)*COL_R,
                   Math.cos(ua)*COL_R, COL_H, Math.sin(ua)*COL_R);
        }
        var cg=new THREE.BufferGeometry();
        cg.setAttribute("position", new THREE.Float32BufferAttribute(pts,3));
        column.add(new THREE.LineSegments(cg, lineMaterial(PROJ, 0.11)));
      })();

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
          ctx.fillStyle = "rgba(160,250,255,0.50)";          // bright head
          ctx.fillText(ch, c*COLW + 3, C.y);
          ctx.fillStyle = "rgba(60,170,200,0.20)";           // dimmer trail
          ctx.fillText(GLYPHS[(Math.random()*GLYPHS.length)|0], c*COLW + 3, C.y - 19);
        }

        // the readout band, redrawn every frame so it never fades away
        ctx.fillStyle = "rgba(0,0,0,0.80)";
        ctx.fillRect(0, 84, cv.width, 86);
        ctx.strokeStyle = "rgba(95,227,255,0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0,85); ctx.lineTo(cv.width,85);
        ctx.moveTo(0,169); ctx.lineTo(cv.width,169);
        ctx.stroke();

        ctx.textAlign = "center";
        ctx.fillStyle = st.mode === "run"  ? "rgba(95,240,168,0.95)"
                      : st.mode === "wait" ? "rgba(255,180,84,0.95)"
                      : st.mode === "ask"  ? "rgba(111,168,255,0.95)"
                      : "rgba(95,227,255,0.75)";
        ctx.font = "12px ui-monospace, Menlo, monospace";
        ctx.fillText(st.head + (st.secs > 1 ? "   " + st.secs + "s" : ""), cv.width/2, 106);

        ctx.fillStyle = "#eaf7ff";
        ctx.font = "bold 30px ui-monospace, Menlo, monospace";
        var t = String(st.label || "—");
        if(t.length > 20) t = t.slice(0,19) + "\u2026";
        ctx.fillText(t, cv.width/2, 140);

        ctx.font = "11px ui-monospace, Menlo, monospace";
        ctx.fillStyle = "rgba(139,163,184,0.75)";
        ctx.fillText("EV " + events, cv.width/2 - 52, 161);
        ctx.fillStyle = errors > 0 ? "rgba(255,95,109,0.9)" : "rgba(95,240,168,0.75)";
        ctx.fillText("ERR " + errors, cv.width/2 + 52, 161);
        ctx.textAlign = "left";

        tex.needsUpdate = true;
      }

      return {
        column: column,
        tick: function(dt, st, busy, events, errors){
          column.rotation.y += dt * (0.16 + busy*0.30);   // the text goes round
          acc += dt;
          if(acc < 0.055) return;      // ~18 fps is plenty for a readout
          draw(Math.min(0.12, acc), st, busy, events, errors);
          acc = 0;
        }
      };
    })();

    // comms mast: the station for anything that leaves the hull
    var mast = new THREE.Group();
    mast.position.set(-10.5, 0, 10.5);
    workshop.add(mast);
    addBox(mast, 0.3, 9.4, 0.3, [0, 4.7, 0], 0, wFaint);
    [[0,1],[0.9,0.6],[-0.9,0.6]].forEach(function(o){
      var d=new THREE.LineSegments(boxLines(0.1, 1.5, 0.1), wLine);
      d.position.set(o[0], 8.9, 0);
      d.rotation.z = o[0]*0.5;
      mast.add(d);
    });
    (function(){                       // dish
      var pts=[], seg=24, R=1.1;
      for(var i=0;i<seg;i++){
        var a0=(i/seg)*Math.PI*2, a1=((i+1)/seg)*Math.PI*2;
        pts.push(Math.cos(a0)*R,0,Math.sin(a0)*R, Math.cos(a1)*R,0,Math.sin(a1)*R);
        pts.push(0,0.5,0, Math.cos(a0)*R,0,Math.sin(a0)*R);
      }
      var g2=new THREE.BufferGeometry();
      g2.setAttribute("position",new THREE.Float32BufferAttribute(pts,3));
      var dish=new THREE.LineSegments(g2, wLine);
      dish.position.set(0, 7.8, 0);
      dish.rotation.x = -0.7;
      mast.add(dish);
    })();

    // Charging bay: where the droid docks while the context is compacted
    var bay = new THREE.Group();
    bay.position.set(0, 0, 16.0);
    workshop.add(bay);
    addBox(bay, 5.2, 0.24, 4.2, [0, 0.12, 0], 0, wLine);        // pad
    [-2.4, 2.4].forEach(function(x){
      addBox(bay, 0.26, 6.2, 0.26, [x, 3.1, -1.2], 0, wFaint);  // uprights
    });
    addBox(bay, 5.2, 0.28, 0.28, [0, 6.2, -1.5], 0, wLine);     // arch
    [-1.0, 1.0].forEach(function(x){
      addBox(bay, 0.5, 0.5, 0.9, [x, 5.0, -0.9], 0, wWarm);     // emitters
    });
    (function(){                                                 // pad markings
      var pts=[];
      for(var i=0;i<6;i++){
        var z=-1.2+i*0.5;
        pts.push(-1.6, 0.24, z, 1.6, 0.24, z);
      }
      var g4=new THREE.BufferGeometry();
      g4.setAttribute("position", new THREE.Float32BufferAttribute(pts,3));
      bay.add(new THREE.LineSegments(g4, wWarm));
    })();

    /* The bay's ledger. cost-state carries the session's real running totals
       — spend, lines added and removed, how much of the wall clock went to
       tools versus to the model — so this panel is read, never estimated.
       It is also what stops the bay from meaning something only during a
       compaction: the accounting is on the wall the whole time. */
    var ledger = (function(){
      var cv = document.createElement("canvas");
      cv.width = 512; cv.height = 300;
      var ctx = cv.getContext("2d");
      var tex = new THREE.CanvasTexture(cv);
      tex.minFilter = THREE.LinearFilter;
      var mat = new THREE.MeshBasicMaterial({
        map:tex, transparent:true, opacity:0.55,
        blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide
      });
      var panel = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 2.52), mat);
      panel.position.set(0, 3.62, -1.34);
      bay.add(panel);
      addBox(bay, 4.45, 2.66, 0.08, [0, 3.62, -1.40], 0, wLine);

      var cur = null, shown = { usd:0, added:0, removed:0 }, dirty = true;

      function bar(x, y, w, h, frac, col){
        ctx.strokeStyle = "rgba(95,227,255,0.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = col;
        ctx.fillRect(x+1, y+1, Math.max(0, (w-2)*clamp(frac,0,1)), h-2);
      }
      function draw(){
        ctx.fillStyle = "rgba(0,0,0,0.88)";
        ctx.fillRect(0,0,cv.width,cv.height);
        ctx.strokeStyle = "rgba(95,227,255,0.45)";
        ctx.lineWidth = 2;
        ctx.strokeRect(6,6,cv.width-12,cv.height-12);

        ctx.textAlign = "left";
        ctx.font = "13px ui-monospace, Menlo, monospace";
        ctx.fillStyle = "rgba(95,227,255,0.75)";
        ctx.fillText("SESSION LEDGER", 22, 34);

        if(!cur){
          ctx.fillStyle = "rgba(139,163,184,0.6)";
          ctx.font = "15px ui-monospace, Menlo, monospace";
          ctx.fillText("awaiting cost-state", 22, 78);
          tex.needsUpdate = true;
          return;
        }

        ctx.fillStyle = "#eaf7ff";
        ctx.font = "bold 40px ui-monospace, Menlo, monospace";
        ctx.fillText("$" + shown.usd.toFixed(2), 22, 82);

        ctx.font = "12px ui-monospace, Menlo, monospace";
        ctx.fillStyle = "rgba(139,163,184,0.8)";
        ctx.fillText("elapsed " + Math.round(cur.durMs/3600000) + " h", 300, 60);
        ctx.fillText("api " + Math.round(cur.apiMs/60000) + " min", 300, 80);

        // lines added and removed, contrasted on one axis
        var tot = Math.max(1, shown.added + shown.removed);
        ctx.fillStyle = "rgba(95,240,168,0.85)";
        ctx.fillText("+" + Math.round(shown.added), 22, 116);
        ctx.textAlign = "right";
        ctx.fillStyle = "rgba(255,95,109,0.85)";
        ctx.fillText("−" + Math.round(shown.removed), cv.width-22, 116);
        ctx.textAlign = "left";
        var bw = cv.width-44;
        var aw = bw * (shown.added/tot);
        ctx.fillStyle = "rgba(95,240,168,0.55)"; ctx.fillRect(22, 124, aw, 12);
        ctx.fillStyle = "rgba(255,95,109,0.55)"; ctx.fillRect(22+aw, 124, bw-aw, 12);

        // thinking versus doing: the split people always guess wrong
        var work = Math.max(1, cur.apiMs + cur.toolMs);
        ctx.fillStyle = "rgba(139,163,184,0.8)";
        ctx.font = "11px ui-monospace, Menlo, monospace";
        ctx.fillText("MODEL  " + Math.round(100*cur.apiMs/work) + "%", 22, 164);
        ctx.textAlign = "right";
        ctx.fillText(Math.round(100*cur.toolMs/work) + "%  TOOLS", cv.width-22, 164);
        ctx.textAlign = "left";
        bar(22, 172, bw, 10, cur.apiMs/work, "rgba(95,227,255,0.55)");

        // per model, biggest spender first — the fleet's own bill
        var y = 206;
        for(var i=0; i<cur.models.length && i<3; i++){
          var M = cur.models[i];
          var nm = M.name.replace(/^claude-/,"").replace(/-\d{8}.*$/,"").slice(0,22);
          ctx.fillStyle = "rgba(95,227,255,0.7)";
          ctx.fillText(nm, 22, y);
          ctx.textAlign = "right";
          ctx.fillStyle = "#eaf7ff";
          ctx.fillText("$" + M.usd.toFixed(2), cv.width-22, y);
          ctx.textAlign = "left";
          bar(22, y+6, bw, 6, M.usd/Math.max(0.0001,cur.models[0].usd), "rgba(95,227,255,0.35)");
          y += 30;
        }
        tex.needsUpdate = true;
      }
      draw();

      return {
        set: function(c){ cur = c; dirty = true; },
        data: function(){ return cur; },
        tick: function(dt){
          if(!cur) return;
          // the totals roll up rather than snapping: a ledger, not a readout
          var before = shown.usd + shown.added + shown.removed;
          shown.usd     = damp(shown.usd,     cur.usd,     3, dt);
          shown.added   = damp(shown.added,   cur.added,   3, dt);
          shown.removed = damp(shown.removed, cur.removed, 3, dt);
          if(dirty || Math.abs(before-(shown.usd+shown.added+shown.removed)) > 0.02){
            dirty = false; draw();
          }
        }
      };
    })();

    /* Each fixture is a STATION for a class of work. When the bay is up the
       droid drives to the right one and the prop is mounted there, instead
       of floating beside him — the workshop stops being scenery. */
    function station(kind, stand, mount, markAt, markR){
      var mm = lineMaterial(PROJ, 0);
      var pts=[], seg=48;
      for(var i=0;i<seg;i++){
        var a0=(i/seg)*Math.PI*2, a1=((i+1)/seg)*Math.PI*2;
        pts.push(Math.cos(a0)*markR, 0, Math.sin(a0)*markR,
                 Math.cos(a1)*markR, 0, Math.sin(a1)*markR);
      }
      var g3=new THREE.BufferGeometry();
      g3.setAttribute("position", new THREE.Float32BufferAttribute(pts,3));
      var ring=new THREE.LineSegments(g3, mm);
      ring.position.set(markAt[0], 0.03, markAt[1]);
      scene.add(ring);                                   // world space
      return { kind:kind,
               stand:new THREE.Vector3(stand[0],0,stand[1]),
               mount:new THREE.Vector3(mount[0],mount[1],mount[2]),
               mat:mm, ring:ring, lit:0 };
    }
    // fixtures live in a group scaled to 0.74, so stations are given in world
    var STATIONS = {
      read:   station("read",   [-9.4,-2.2], [-12.2, 2.8, -2.8], [-13.0,-3.0], 3.4),
      write:  null,
      term:   station("term",   [ 3.2,-9.6], [  4.3, 3.6,-12.0], [  4.5,-13.0], 3.2),
      index:  station("index",  [ 8.8,-4.2], [ 11.8, 2.8, -5.4], [ 12.5,-5.2], 3.4),
      globe:  station("globe",  [-7.4, 7.4], [-10.0, 4.4, 10.0], [-10.5, 10.5], 3.4),
      charge: station("charge", [ 0.0,13.2], [  0.0, 3.8, 16.2], [  0.0,16.0], 3.6)
    };
    STATIONS.write = STATIONS.read;                      // same bench

    /* Ceiling. It was a dense web at 15 and it read as a lid pressing down on
       the bay: at this camera height you were always looking at it. Now it is
       two sparse rings far above the gantry — enough to close the volume,
       little enough to stay out of every sightline. */
    (function(){
      var pts=[], seg=64;
      [15, 22].forEach(function(r){
        for(var i=0;i<seg;i++){
          if(i % 2) continue;                       // dashed: half the ink
          var a0=(i/seg)*Math.PI*2, a1=((i+1)/seg)*Math.PI*2;
          pts.push(Math.cos(a0)*r, 0, Math.sin(a0)*r, Math.cos(a1)*r, 0, Math.sin(a1)*r);
        }
      });
      for(var k3=0;k3<6;k3++){
        var a3=(k3/6)*Math.PI*2;
        pts.push(Math.cos(a3)*15,0,Math.sin(a3)*15, Math.cos(a3)*22,0,Math.sin(a3)*22);
      }
      var cg2=new THREE.BufferGeometry();
      cg2.setAttribute("position", new THREE.Float32BufferAttribute(pts,3));
      var ceil=new THREE.LineSegments(cg2, lineMaterial(PROJ, 0.08));
      ceil.position.y = 24.0;
      workshop.add(ceil);
    })();

    /* An invisible volume over each fixture, so the bay can explain itself:
       hover names it, a click opens a card. Nothing about the model changes. */
    function pick(w,h,d, pos, info){
      var m = new THREE.Mesh(
        new THREE.BoxGeometry(w,h,d),
        new THREE.MeshBasicMaterial({transparent:true, opacity:0, depthWrite:false})
      );
      m.position.set(pos[0], pos[1], pos[2]);
      m.userData.info = info;
      workshop.add(m);
      PICKS.push(m);
    }
    pick(7.0, 4.0, 3.2, [-13.0, 2.0, -3.2], {
      kind:"Station · bench", title:"Workbench",
      body:"Where file work happens: the droid drives here and the page it is reading or writing is projected over the bench. The tiles laid out on the surface are the session's footprint — one per file the transcript records as edited, brighter the more often it has been touched. They stay after the work moves on.",
      tools:"Read · Write · Edit · MultiEdit · file-history-delta"
    });
    pick(4.4, 5.2, 2.0, [4.5, 2.6, -13.0], {
      kind:"Station · screen", title:"Diagnostic screen",
      body:"The shell station. A terminal panel with scrolling output is mounted here for the length of the command.",
      tools:"Bash · BashOutput · KillShell"
    });
    pick(5.5, 4.0, 8.5, [12.5, 2.0, -5.5], {
      kind:"Station · crates", title:"Parts crates",
      body:"Search and listing work. A directory grid is swept by a reticle while the query runs.",
      tools:"Grep · Glob · LS · TodoRead · TodoWrite"
    });
    pick(3.6, 10.0, 3.6, [-10.5, 5.0, 10.5], {
      kind:"Station · mast", title:"Comms mast",
      body:"Anything that leaves the hull. A wireframe globe turns beside the dish while the call is open.",
      tools:"WebSearch · WebFetch · MCP tools"
    });
    pick(6.0, 7.0, 5.0, [0, 3.2, 16.0], {
      kind:"Station · bay", title:"Charging bay & ledger",
      body:"The droid docks here when the transcript logs a context compaction, and energy rings climb the hull. The panel on the arch is the session's accounting: spend, lines added against lines removed, and how the wall clock split between the model thinking and the tools running. Those totals are read from the transcript, not estimated.",
      tools:"compact_boundary · cost-state"
    });
    pick(1.6, 3.4, 1.6, [3.1, 1.7, 3.1], {
      kind:"Station · queue", title:"Message queue",
      body:"One block per message waiting to be sent. The transcript logs every enqueue, dequeue and removal, so the stack is the real backlog: it grows while you type ahead and burns down as the session catches up.",
      tools:"queue-operation"
    });
    pick(3.2, 6.0, 3.2, [0, 3.0, 0], {
      kind:"Readout", title:"Holo column",
      body:"The session readout: current state, the tool in flight with its elapsed time, and a glyph rain whose speed tracks how busy the session is. It stays up even with the bay hidden.",
      tools:"always on"
    });

    workshop.userData = { trolley:trolley, hook:hook, monitor:monitor,
                          stations:STATIONS, mast:mast, bay:bay,
                          bench:bench, tiles:TILES, ledger:ledger };
  })();

  /* ===================================================================
     5c. SESSION INSTRUMENTS
     Four fixtures that live in world space rather than in the bay, because
     each of them reads a signal about the session as a whole rather than
     about one tool call.
     =================================================================== */
  function ringGeo(seg, dash){
    var pts=[];
    for(var i=0;i<seg;i++){
      if(dash && (i%2)) continue;
      var a0=(i/seg)*Math.PI*2, a1=((i+1)/seg)*Math.PI*2;
      pts.push(Math.cos(a0),0,Math.sin(a0), Math.cos(a1),0,Math.sin(a1));
    }
    var g=new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts,3));
    return g;
  }

  /* --- sonar: the model is talking to the human ----------------------
     A tool call is the droid working; prose addressed to you is the droid
     turning round and saying something. That deserves its own gesture, and
     a sonar ping is the one signal in the scene that travels outward to
     where you are instead of staying on the model. */
  var SONAR = (function(){
    var g = ringGeo(80, false), out = [];
    for(var k=0;k<3;k++){
      var m = lineMaterial(new THREE.Color(0xbff4ff), 0);
      var o = new THREE.LineSegments(g, m);
      o.visible = false;
      scene.add(o);
      out.push({obj:o, mat:m, off:k*0.20});
    }
    return out;
  })();
  var SONAR_DUR = 2.0;
  var sonarReq = false, sonarT0 = -99, sonarX = 0, sonarY = 0, sonarZ = 0;

  /* --- footprints: faint heat where the primary walked, gone in seconds.
     Same language as the sonar rings, kept barely visible on purpose. */
  var TRAIL_N = 10, TRAIL_LIFE = 4;
  var TRAIL = (function(){
    var g = ringGeo(48, false), out = [];
    for(var k=0;k<TRAIL_N;k++){
      var m = lineMaterial(PROJ, 0);
      var o = new THREE.LineSegments(g, m);
      o.visible = false;
      scene.add(o);
      out.push({obj:o, mat:m, life:0});
    }
    return out;
  })();
  var trailAcc = 0;

  /* --- turn rings: a record of how long each turn took ----------------
     system/turn_duration carries a real durationMs. Each closed turn drops
     a ring sized by its own length, and the rings fade over about a minute,
     so the floor keeps a short memory of the session's rhythm. It also gives
     the dead air while the model thinks something to resolve into. */
  var TURNS = (function(){
    var g = ringGeo(72, false), out = [];
    for(var k=0;k<12;k++){
      var m = lineMaterial(PROJ, 0);
      var o = new THREE.LineSegments(g, m);
      o.visible = false;
      scene.add(o);
      out.push({obj:o, mat:m, life:0, r:1, grow:0});
    }
    return out;
  })();
  function turnRing(ms){
    // log scale: a 90 s turn should read as bigger than a 6 s one without
    // being fifteen times the radius
    var r = clamp(2.4 + Math.log(1 + (ms||0)/1000)*2.6, 2.4, 16);
    var slot = null, worst = 2;
    for(var i=0;i<TURNS.length;i++){
      if(TURNS[i].life <= 0){ slot = TURNS[i]; break; }
      if(TURNS[i].life < worst){ worst = TURNS[i].life; slot = TURNS[i]; }
    }
    slot.life = 1; slot.r = r; slot.grow = 0;
    slot.obj.position.set(droid.position.x, 0.02, droid.position.z);
    slot.obj.visible = true;
  }

  /* --- queue stack: messages waiting to be sent ----------------------- */
  var QSTACK = (function(){
    var g = new THREE.Group();
    g.position.set(3.1, 0, 3.1);
    scene.add(g);
    g.add(new THREE.LineSegments(edgesOf(new THREE.BoxGeometry(1.0,0.06,1.0),1),
                                 lineMaterial(PROJ, 0.16)));
    var bg = edgesOf(new THREE.BoxGeometry(0.66,0.24,0.66),1), blocks = [];
    for(var i=0;i<9;i++){
      var m = lineMaterial(PROJ, 0);
      var o = new THREE.LineSegments(bg, m);
      o.position.y = 0.20 + i*0.28;
      o.visible = false;
      g.add(o);
      blocks.push({obj:o, mat:m, lv:0});
    }
    return { group:g, blocks:blocks };
  })();

  /* --- supervision: the room says when nobody is being asked ----------
     permission-mode is the one signal in the transcript with a real safety
     meaning, and it was the one thing here you could not see. Under
     bypassPermissions the perimeter goes amber. */
  var SUPER = (function(){
    var m = lineMaterial(AMBER, 0);
    var ring = new THREE.LineSegments(ringGeo(96, true), m);
    ring.position.y = 0.04;
    ring.scale.setScalar(17.4);
    scene.add(ring);
    var posts = [[-15.5,-15.5],[15.5,-15.5],[-15.5,15.5],[15.5,15.5],
                 [0,-16.5],[0,16.5],[-16.5,0],[16.5,0]];
    var pts = [];
    posts.forEach(function(p){ pts.push(p[0],0.1,p[1], p[0],3.4,p[1]); });
    var pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.Float32BufferAttribute(pts,3));
    var bars = new THREE.LineSegments(pg, m);
    scene.add(bars);
    return { mat:m, lit:0, ring:ring, bars:bars };
  })();

  /* ===================================================================
     6. ORBIT CONTROLS
     =================================================================== */
  /* R2 does not stand still while it works: it rolls around the bay,
     turns to face where it is going and banks into the corners. */
  var roam = {
    pos:new THREE.Vector3(), target:new THREE.Vector3(),
    heading:0, bank:0, next:0, speed:0,
    // where it stopped when the work ran out: held so it stays put instead
    // of drifting (damping toward a live pos never quite settles)
    hold:new THREE.Vector3(), held:false
  };
  var roamOn = !reduce;

  var cam = {theta:0.62, phi:1.07, radius:31, target:new THREE.Vector3(0,3.4,0)};
  var HOME = {theta:0.62, phi:1.07, radius:31};
  var autoSpin = !reduce;
  var camGoal = null;   // right-click focus: chased for a few seconds, then released
  var prevClaimed = {}; // last frame's fixture bookings, for the bench lights

  /* --- first / third person --------------------------------------------
     Orbit is the default. First glues the camera to the primary's eye and
     drag looks around. Third spawns you as a holo ball: WASD/arrows drive
     it camera-relative, the camera follows it, hand-written physics only
     (floor clamp + circle push-outs, nothing more). */
  var viewMode = "orbit";
  var VIEW_LABEL = { orbit:"Orbit", first:"1st", third:"3rd" };
  var keys = {};
  // orbit freefly: WASD/QE slide cam.target on its own. Touching a drive key
  // takes the target off the auto-follow (3265) — otherwise the two fight.
  // Re-anchors on Home/R, or when leaving orbit.
  var flyOn = false;
  var flyVel = new THREE.Vector3();
  var FLY_ACCEL = 34, FLY_MAXV = 16, FLY_DRAG = 5, FLY_BOUND = 40, FLY_Y = [0.6, 26];
  var fpYaw = 0, fpPitch = 0;
  var BALL_R = 0.35, BALL_BOUND = 15, BALL_ACCEL = 16, BALL_MAXV = 7;
  var me = { pos:new THREE.Vector3(4, BALL_R, 4), vel:new THREE.Vector3() };
  var meGroup = new THREE.Group();
  meGroup.add(new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 18, 12),
    new THREE.MeshBasicMaterial({ color:0x9df2ff, transparent:true, opacity:0.85,
      blending:THREE.AdditiveBlending, depthWrite:false })));
  meGroup.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.SphereGeometry(BALL_R*1.45, 10, 8)),
    lineMaterial(PROJ, 0.5)));
  meGroup.visible = false;
  scene.add(meGroup);
  var POSTS = [[-15.5,-15.5],[15.5,-15.5],[-15.5,15.5],[15.5,15.5],
               [0,-16.5],[0,16.5],[-16.5,0],[16.5,0]];
  function setView(m){
    viewMode = m;
    flyRelease();   // freefly is orbit-only; never carry it across a mode switch
    camGoal = null; // nor a right-click focus: it would keep writing cam.target
    btnView.textContent = "View: " + VIEW_LABEL[m];
    btnView.setAttribute("aria-pressed", m === "orbit" ? "false" : "true");
    meGroup.visible = (m === "third");
    // one walker for both modes: first starts at the droid and walks with
    // WASD like third does, only the camera differs
    if(m === "first"){
      me.pos.set(droid.position.x, BALL_R, droid.position.z);
      me.vel.set(0, 0, 0);
      fpYaw = Math.atan2(cam.target.x - camera.position.x, cam.target.z - camera.position.z);
      fpPitch = 0;
    }
    camera.fov = (m === "first") ? 48 : 42;
    camera.updateProjectionMatrix();
  }
  function collideXZ(cx, cz, rad){
    var dx = me.pos.x-cx, dz = me.pos.z-cz, rr = rad + BALL_R;
    var d2 = dx*dx + dz*dz;
    if(d2 < rr*rr && d2 > 1e-8){
      var d = Math.sqrt(d2), nx = dx/d, nz = dz/d;
      me.pos.x = cx + nx*rr; me.pos.z = cz + nz*rr;
      var vn = me.vel.x*nx + me.vel.z*nz;   // slide along the edge
      if(vn < 0){ me.vel.x -= nx*vn; me.vel.z -= nz*vn; }
    }
  }
  var stepTmpF = new THREE.Vector3(), stepTmpR = new THREE.Vector3();
  function stepMe(dt, t){
    var ix = ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0);
    var iz = ((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0);
    stepTmpF.copy(cam.target).sub(camera.position); stepTmpF.y = 0;
    if(stepTmpF.lengthSq() < 1e-6) stepTmpF.set(0, 0, 1);
    stepTmpF.normalize();
    stepTmpR.set(-stepTmpF.z, 0, stepTmpF.x);
    me.vel.addScaledVector(stepTmpF, iz*BALL_ACCEL*dt);
    me.vel.addScaledVector(stepTmpR, ix*BALL_ACCEL*dt);
    me.vel.multiplyScalar(Math.exp(-4*dt));
    var sp = Math.sqrt(me.vel.x*me.vel.x + me.vel.z*me.vel.z);
    if(sp > BALL_MAXV){ me.vel.x *= BALL_MAXV/sp; me.vel.z *= BALL_MAXV/sp; }
    me.pos.x += me.vel.x*dt; me.pos.z += me.vel.z*dt;
    // no column collision: it floats at COL_BASE 5.2 so you walk underneath
    collideXZ(droid.position.x, droid.position.z, 1.3);    // primary
    Object.keys(AGENTS).forEach(function(id){
      var A = AGENTS[id];
      collideXZ(A.wrap.position.x, A.wrap.position.z, 1.0);
    });
    for(var pi=0; pi<POSTS.length; pi++) collideXZ(POSTS[pi][0], POSTS[pi][1], 0.6);
    var dc = Math.sqrt(me.pos.x*me.pos.x + me.pos.z*me.pos.z);   // outer bound
    if(dc > BALL_BOUND - BALL_R){
      me.pos.x *= (BALL_BOUND - BALL_R)/dc; me.pos.z *= (BALL_BOUND - BALL_R)/dc;
      var onx = me.pos.x/dc, onz = me.pos.z/dc;
      var ovn = me.vel.x*onx + me.vel.z*onz;
      if(ovn > 0){ me.vel.x -= onx*ovn; me.vel.z -= onz*ovn; }
    }
    me.pos.y = BALL_R + Math.abs(Math.sin(t*3))*0.03*Math.min(1, sp);
    meGroup.position.copy(me.pos);
    meGroup.rotation.y += sp*dt*1.5;
  }

  /* Freefly for orbit: slides cam.target itself, so the existing spherical
     rig keeps working — drag still orbits, wheel still zooms, we only move
     what they orbit around. Forward comes from the camera's own facing so
     "forward" is always where you look. */
  var flyTmpF = new THREE.Vector3(), flyTmpR = new THREE.Vector3();
  function flyInput(){
    return {
      x: ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0),
      z: ((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0),
      y: ((keys.KeyE || keys.Space) ? 1 : 0) - ((keys.KeyQ || keys.ShiftLeft || keys.ShiftRight) ? 1 : 0)
    };
  }
  function stepFly(dt){
    var i = flyInput();
    if(i.x || i.z || i.y) flyOn = true;      // first key press takes the wheel
    if(!flyOn) return;
    // ground-plane basis from where the camera looks, so W goes into the screen
    flyTmpF.copy(cam.target).sub(camera.position); flyTmpF.y = 0;
    if(flyTmpF.lengthSq() < 1e-6) flyTmpF.set(0, 0, 1);
    flyTmpF.normalize();
    flyTmpR.set(-flyTmpF.z, 0, flyTmpF.x);
    var boost = (keys.ShiftLeft || keys.ShiftRight) && !i.y ? 2.4 : 1;
    flyVel.addScaledVector(flyTmpF, i.z*FLY_ACCEL*boost*dt);
    flyVel.addScaledVector(flyTmpR, i.x*FLY_ACCEL*boost*dt);
    flyVel.y += i.y*FLY_ACCEL*0.7*dt;
    flyVel.multiplyScalar(Math.exp(-FLY_DRAG*dt));
    var sp = flyVel.length();
    if(sp > FLY_MAXV*boost) flyVel.multiplyScalar(FLY_MAXV*boost/sp);
    cam.target.addScaledVector(flyVel, dt);
    // keep the target in the room: clamp height, rein in the horizontal drift
    cam.target.y = clamp(cam.target.y, FLY_Y[0], FLY_Y[1]);
    if(cam.target.y === FLY_Y[0] || cam.target.y === FLY_Y[1]) flyVel.y = 0;
    var dc = Math.sqrt(cam.target.x*cam.target.x + cam.target.z*cam.target.z);
    if(dc > FLY_BOUND){
      cam.target.x *= FLY_BOUND/dc; cam.target.z *= FLY_BOUND/dc;
      var nx = cam.target.x/dc, nz = cam.target.z/dc;
      var vn = flyVel.x*nx + flyVel.z*nz;
      if(vn > 0){ flyVel.x -= nx*vn; flyVel.z -= nz*vn; }
    }
  }
  function flyRelease(){ flyOn = false; flyVel.set(0, 0, 0); }

  function applyCamera(){
    cam.phi = clamp(cam.phi, 0.22, Math.PI-0.22);
    cam.radius = clamp(cam.radius, 6, 85);
    var s=Math.sin(cam.phi);
    camera.position.set(
      cam.target.x + cam.radius*s*Math.sin(cam.theta),
      cam.target.y + cam.radius*Math.cos(cam.phi),
      cam.target.z + cam.radius*s*Math.cos(cam.theta)
    );
    camera.lookAt(cam.target);
  }
  var drag=null, pinch=null, el=renderer.domElement;
  var pressAt = 0, pressX = 0, pressY = 0;
  el.addEventListener("pointerdown",function(e){
    el.setPointerCapture(e.pointerId); drag={x:e.clientX,y:e.clientY};
    pressAt = performance.now(); pressX = e.clientX; pressY = e.clientY;
    autoSpin=false; syncSpin();
    if(e.button === 2){
      // right click on the dome: glide over for a closer look, left stays info.
      // Orbit only — in first person the drag is already looking around.
      if(viewMode === "orbit" && pickDroid(e.clientX, e.clientY)){
        camGoal = { x:droid.position.x, z:droid.position.z, r:14, until:performance.now()+6000 };
      }
    } else {
      camGoal = null;
    }
  });
  el.addEventListener("contextmenu",function(e){ e.preventDefault(); });
  el.addEventListener("pointermove",function(e){
    if(!drag){                                  // hover: name the fixture
      var h = pickAt(e.clientX, e.clientY);
      var dh = h ? null : pickDroid(e.clientX, e.clientY);
      hovered = h;
      el.style.cursor = (h || dh) ? "pointer" : "grab";
      if(h){
        hintEl.textContent = h.userData.info.title;
        hintEl.dataset.cx = e.clientX; hintEl.dataset.cy = e.clientY;
      } else {
        hintEl.style.display = "none";
      }
      return;
    }
    if(viewMode === "first"){   // drag looks around from the droid's eye
      fpYaw -= (e.clientX-drag.x)*0.005;
      fpPitch = clamp(fpPitch - (e.clientY-drag.y)*0.005, -1.2, 1.2);
      drag.x=e.clientX; drag.y=e.clientY;
      return;
    }
    cam.theta -= (e.clientX-drag.x)*0.006;
    cam.phi   -= (e.clientY-drag.y)*0.006;
    drag.x=e.clientX; drag.y=e.clientY; applyCamera();
  });
  function endDrag(e){
    if(drag){ try{el.releasePointerCapture(e.pointerId);}catch(x){} }
    drag=null;
    // a short press that barely moved is a click, not an orbit
    var moved = Math.abs(e.clientX-pressX) + Math.abs(e.clientY-pressY);
    if(performance.now()-pressAt < 300 && moved < 6){
      var h = pickAt(e.clientX, e.clientY);
      if(h) openStation(h);
      else if(pickDroid(e.clientX, e.clientY)) showAgent("main");
      else closeStation();
    }
  }
  el.addEventListener("pointerup",endDrag);
  el.addEventListener("pointercancel",endDrag);
  el.addEventListener("wheel",function(e){
    e.preventDefault();
    camGoal = null;
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

  /* --- station picking ------------------------------------------------ */
  var ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  var hintEl = document.getElementById("station-hint");
  var hovered = null, openPick = null, stationView = null;

  function pickAt(cx, cy){
    if(!shopOn) return null;
    var r = el.getBoundingClientRect();
    ndc.x =  ((cx - r.left)/r.width)*2 - 1;
    ndc.y = -((cy - r.top)/r.height)*2 + 1;
    ray.setFromCamera(ndc, camera);
    var hits = ray.intersectObjects(PICKS, false);
    return hits.length ? hits[0].object : null;
  }
  /* The primary has no always-visible tag, so its head is the button:
     any visible droid mesh counts, dead particles and hidden props don't. */
  function pickDroid(cx, cy){
    var r = el.getBoundingClientRect();
    ndc.x =  ((cx - r.left)/r.width)*2 - 1;
    ndc.y = -((cy - r.top)/r.height)*2 + 1;
    ray.setFromCamera(ndc, camera);
    var hits = ray.intersectObjects(droid.children, true).filter(function(h){
      // faded-out halos stay in the scene: don't let them catch clicks
      var m = h.object.material;
      if(m && m.transparent && m.opacity < 0.05) return false;
      return h.object.visible !== false && !h.object.isPoints;
    });
    return hits.length ? hits[0].object : null;
  }
  function openStation(obj){
    agentView = null;
    openPick = obj;
    stationView = obj.userData.info;
    Object.keys(railEls).forEach(function(k){    // no subsystem is selected now
      railEls[k].setAttribute("aria-selected", "false");
    });
    showReadout(true);
    renderStation();
  }
  function closeStation(){
    openPick = null;
    if(stationView){ stationView = null; select(active); }
  }

  /* ===================================================================
     7. RAIL, READOUT
     =================================================================== */
  var rail=document.getElementById("rail");
  var readout=document.getElementById("readout");

  var head=document.createElement("div");
  head.className="eyebrow rail-h"; head.textContent="Subsystems";
  rail.appendChild(head);

  var active=SYSTEMS[0].id, railEls={};

  SYSTEMS.forEach(function(sys){
    var b=document.createElement("button");
    b.className="sysbtn"; b.setAttribute("role","tab");
    b.dataset.kind=sys.kind; b.dataset.id=sys.id;
    b.innerHTML='<span class="tag">'+sys.tag+'</span><span class="name">'+sys.name+'</span><span class="n">0</span>';
    b.addEventListener("click",function(){ select(sys.id); });
    rail.appendChild(b);
    railEls[sys.id]=b;
  });

  function fmtN(n){ return n.toLocaleString("en-US"); }
  /* Transcript-controlled strings (tool names, paths, model ids) end up in
     innerHTML below. Same-user local data, but escape anyway: a hostile
     transcript must not become script in the page. */
  function esc(s){
    return String(s ?? "").replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  /* One droid per workshop fixture. A bench is takeable when nobody has
     booked it yet this frame AND last frame's holder is us or gone — the
     second half is what stops two subagents wanting the same bench from
     trading it every frame and jittering between the two spots.
     `now`/`prev` are the holder ids ("main" for the primary), or undefined. */
  function canClaim(now, prev, id){
    return (now === undefined || now === id) &&
           (prev === undefined || prev === id);
  }
  function fleetSummary(){
    var c={r2:0,r4:0,r5:0};
    Object.keys(AGENTS).forEach(function(id){ c[AGENTS[id].series] = (c[AGENTS[id].series]||0)+1; });
    var out=[];
    if(c.r2) out.push(c.r2+"× R2");
    if(c.r4) out.push(c.r4+"× R4");
    if(c.r5) out.push(c.r5+"× R5");
    return out.length ? out.join(", ") : "none";
  }

  /* The session block is the same under either view: it describes the run,
     not the thing you happen to have selected. */
  function sessionRows(){
    return '<div class="eyebrow live-h">Session</div>'+
      '<dl class="specs">'+
        '<dt>Last tool</dt><dd>'+esc(live.lastTool)+'</dd>'+
        '<dt>Model</dt><dd>'+esc(live.model)+'</dd>'+
        '<dt>Fleet</dt><dd>'+fleetSummary()+'</dd>'+
        '<dt>Cache hit</dt><dd>'+Math.round(cacheRatio()*100)+'%</dd>'+
        '<dt>Effort</dt><dd>'+esc(live.effort)+' &middot; '+esc(live.speed)+'</dd>'+
        '<dt>Permissions</dt><dd>'+esc(live.perm)+'</dd>'+
        '<dt>Queue</dt><dd>'+live.queue+'</dd>'+
        '<dt>Turns</dt><dd>'+fmtN(live.turns)+
          (live.turnMs ? ' <span class="mute">(last '+(live.turnMs/1000).toFixed(1)+'s)</span>' : '')+'</dd>'+
        '<dt>Files touched</dt><dd>'+fmtN(live.files)+'</dd>'+
        '<dt>Last file</dt><dd>'+esc(live.lastFile)+'</dd>'+
        '<dt>Events</dt><dd>'+fmtN(live.events)+'</dd>'+
        '<dt>Errors</dt><dd>'+fmtN(live.errors)+'</dd>'+
        '<dt>From subagents</dt><dd>'+fmtN(live.sidechains)+'</dd>'+
        '<dt>Tokens</dt><dd>'+fmtN(live.tokens)+'</dd>'+
        (live.cost
          ? '<dt>Spend</dt><dd>$'+live.cost.usd.toFixed(2)+'</dd>'+
            '<dt>Lines</dt><dd>+'+fmtN(live.cost.added)+' / &minus;'+fmtN(live.cost.removed)+'</dd>'
          : '<dt>Spend</dt><dd>&mdash;</dd>')+
      '</dl>';
  }

  var CLOSE_BTN = '<button id="readout-close" aria-label="Close panel">&#10005;</button>';

  /* Droid view: clicking a tag (subagent or primary) parks the panel on
     that droid instead of a subsystem. Rail selection and station picks
     both clear it. */
  var agentView = null;   // null = subsystem view, "main" or an agent id
  function showAgent(id){
    stationView = null; openPick = null;
    agentView = id;
    showReadout(true);
    renderReadout();
  }
  function renderAgent(){
    if(agentView !== "main" && !AGENTS[agentView]){
      readout.dataset.kind = "std";
      readout.innerHTML = CLOSE_BTN+
        '<div class="eyebrow">Fleet &middot; faded</div>'+
        '<h2>Droid gone</h2>'+
        '<p class="note">This droid faded out after 60 s of silence. The session block below keeps the run totals.</p>'+
        sessionRows();
      return;
    }
    var isMain = agentView === "main";
    var A = isMain ? null : AGENTS[agentView];
    var S = isMain ? { label:"R2" } : SERIES[A.series] || SERIES.r2;
    var st = isMain
      ? (lastMainStatus || { head:"IDLE", label:live.lastTool, secs:0, mode:"idle" })
      : { head:A.mode.toUpperCase(), label:A.mode === "run" ? A.lastTool : A.mode, secs:A.secs, mode:A.mode };
    var since = isMain ? live.lastAt : A.firstAt;
    readout.dataset.kind = st.mode === "wait" ? "alert" : "std";
    readout.innerHTML = CLOSE_BTN+
      '<div class="eyebrow">Fleet &middot; '+(isMain ? "primary" : "subagent "+esc(agentView))+'</div>'+
      '<h2>'+(isMain ? "R2 primary" : S.label+" "+esc(agentView))+'</h2>'+
      '<p class="note">'+(isMain
        ? "The full-size droid working your session directly."
        : "A live subagent, sized by model tier. Nesting is inferred from timing, not read from the transcript.")+'</p>'+
      '<dl class="specs">'+
        '<dt>Status</dt><dd>'+esc(st.head)+(st.secs > 1 ? ' <span class="mute">('+st.secs+'s)</span>' : '')+'</dd>'+
        (isMain
          ? '<dt>Model</dt><dd>'+esc(live.model)+'</dd>'
          : '<dt>Series</dt><dd>'+esc(S.label)+'</dd>'+
            '<dt>Model</dt><dd>'+esc(A.model || "—")+'</dd>'+
            '<dt>Type</dt><dd>'+esc(A.atype || "—")+'</dd>'+
            '<dt>Parent</dt><dd>'+(A.parent ? esc(A.parent) : "primary")+'</dd>'+
            '<dt>Children</dt><dd>'+fmtN(A.kids)+'</dd>')+
        (isMain ? "" : '<dt>Last tool</dt><dd>'+esc(A.lastTool)+'</dd>')+
        (isMain ? "" : '<dt>Tools</dt><dd>'+fmtN(A.tools)+'</dd>')+
        (isMain ? "" : '<dt>Tokens</dt><dd>'+fmtN(A.tokens)+'</dd>')+
        (isMain ? "" : '<dt>Errors</dt><dd>'+fmtN(A.errors)+'</dd>')+
        '<dt>Active since</dt><dd>'+(since ? rel(since) : "—")+'</dd>'+
      '</dl>'+
      sessionRows();
  }

  function renderReadout(){
    if(stationView){ renderStation(); return; }
    if(agentView){ renderAgent(); return; }
    var sys=SYSTEMS.filter(function(s){return s.id===active;})[0];
    var m=MOD[sys.id];
    var rows=sys.specs.map(function(p){ return "<dt>"+p[0]+"</dt><dd>"+p[1]+"</dd>"; }).join("");
    readout.dataset.kind=sys.kind;
    readout.innerHTML = CLOSE_BTN+
      '<div class="eyebrow">'+sys.tag+' &middot; '+sys.label+'</div>'+
      '<h2>'+sys.title+'</h2>'+
      '<p class="note">'+sys.note+'</p>'+
      '<dl class="specs">'+rows+'</dl>'+
      '<dl class="specs live-h">'+
        '<dt>Activations</dt><dd>'+fmtN(m.n)+'</dd>'+
        '<dt>Source</dt><dd>'+sys.tools+'</dd>'+
      '</dl>'+
      sessionRows();
  }

  /* Clicking a fixture in the bay fills this same panel rather than opening
     a card over the scene: one place where descriptions appear, and the
     model stays unobscured. */
  function renderStation(){
    readout.dataset.kind = "std";
    readout.innerHTML = CLOSE_BTN+
      '<div class="eyebrow">'+stationView.kind+'</div>'+
      '<h2>'+stationView.title+'</h2>'+
      '<p class="note">'+stationView.body+'</p>'+
      '<dl class="specs">'+
        '<dt>Source</dt><dd>'+stationView.tools+'</dd>'+
      '</dl>'+
      sessionRows();
  }

  /* The panel can sit in front of the thing it describes, so it closes —
     and any rail entry, any fixture, or the Panel button brings it back. */
  var readoutOpen = true, btnPanel = null;
  function showReadout(on){
    readoutOpen = on;
    readout.style.display = on ? "" : "none";
    if(btnPanel) btnPanel.setAttribute("aria-pressed", on ? "true" : "false");
    savePrefs();
  }
  readout.addEventListener("click", function(e){
    if(e.target.closest && e.target.closest("#readout-close")) showReadout(false);
  });
  /* Curious look: opening a subsystem turns the dome toward that module,
     as if pointing it out. Yaw is droid-local (the modules ride the hull),
     shortest way round; any later turnDome overrides it. */
  var LOOK = { sns:0, trx:0, scp:0.55, man:-0.55, vck:-0.6, ext:0.65,
               int:Math.PI, loc:Math.PI };
  function select(id){
    stationView = null; openPick = null; agentView = null;
    showReadout(true);
    active=id;
    if(!reduce && LOOK[id] !== undefined){
      var want = LOOK[id] - MAIN.domeTarget;
      turnDome(MAIN, ((want + Math.PI*3) % (Math.PI*2)) - Math.PI);
    }
    Object.keys(railEls).forEach(function(k){
      railEls[k].setAttribute("aria-selected", k===id ? "true":"false");
    });
    renderReadout();
  }

  var mainTag=document.getElementById("main-tag");
  mainTag.addEventListener("click", function(){ showAgent("main"); });
  var lastTagKey="", lastMainStatus=null;
  function droidSpeak(){
    var out = [], n = 2 + Math.floor(Math.random()*3);
    for(var i=0;i<n;i++){
      var m = 1 + Math.floor(Math.random()*4), g = "";
      for(var j=0;j<m;j++) g += Math.random() < 0.5 ? "\u00b7" : "\u2212";
      out.push(g);
    }
    return out.join(" ");
  }
  function setMainTag(st){
    lastMainStatus = st;
    // The callout only speaks when the droid is actually doing something.
    // Waiting is the hull lamp's job; idle needs no caption at all.
    if(st.mode !== "run"){
      if(lastTagKey !== "off"){ lastTagKey = "off"; mainTag.dataset.off = "1"; }
      return;
    }
    // R2 doesn't speak Basic: while replying, the tag bleeps droidspeak and
    // the panel stays the translation. Finer key so the glyphs turn over.
    var isDroid = st.mode === "run" && st.label === "replying to you";
    var key = st.mode+"|"+st.label+"|"+st.secs+(isDroid ? "|"+Math.floor(Date.now()/500) : "");
    if(key === lastTagKey) return;              // only touch the DOM on change
    lastTagKey = key;
    mainTag.dataset.off = "0";
    mainTag.dataset.mode = st.mode;
    mainTag.innerHTML =
      '<span class="head"><span class="aser">R2</span>'+
      '<span class="aid">primary</span></span>'+
      '<span class="what">'+esc(isDroid ? droidSpeak() : (st.label||"—"))+'</span>'+
      (st.secs > 1 ? '<span class="secs">'+st.secs+'s</span>' : '');
  }

  var tmp=new THREE.Vector3(), tmpTagV=new THREE.Vector3();
  function updateTags(w,h){
    // Callouts are HTML sitting on top of a 3D scene, so depth has to be
    // applied by hand: nearer ones stack above, and everything shrinks and
    // fades with distance. Without it two tags simply overlap and the far
    // one can end up winning.
    function placeTag(el, world, off){
      // NDC z is non-linear and sits at ~0.99 for everything in frame, so it
      // is useless as a depth cue. Real camera distance is what reads.
      var dist = camera.position.distanceTo(world);
      tmp.copy(world); tmp.project(camera);
      if(tmp.z > 1 || off){ el.style.display="none"; return; }
      el.style.display="flex";
      var k = clamp(1.25 - dist*0.028, 0.60, 1.05);
      el.style.transform =
        "translate("+((tmp.x*0.5+0.5)*w).toFixed(1)+"px,"+((-tmp.y*0.5+0.5)*h).toFixed(1)+"px)"+
        " scale("+k.toFixed(3)+") translate(-50%,-100%)";
      el.style.zIndex = String(Math.max(0, Math.round(100000 - dist*1000)));
      el.style.opacity = clamp(1.35 - dist*0.028, 0.45, 1).toFixed(2);
    }
    if(hovered){
      hintEl.style.display = "block";
      hintEl.style.transform = "translate("+hintEl.dataset.cx+"px,"+
        (Number(hintEl.dataset.cy)-22)+"px) translate(-50%,-100%)";
    } else {
      hintEl.style.display = "none";
    }
    tmpTagV.set(0, 5.2, 0); droid.localToWorld(tmpTagV);
    placeTag(mainTag, tmpTagV, mainTag.dataset.off === "1");
    Object.keys(AGENTS).forEach(function(id){
      var A=AGENTS[id];
      tmpTagV.set(0, 4.8, 0); A.wrap.localToWorld(tmpTagV);
      placeTag(A.el, tmpTagV, false);
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
             : ev.kind==="cost" ? ("ledger $"+(ev.cost?ev.cost.usd.toFixed(2):"?"))
             : ev.kind==="file" ? ("file "+String(ev.path||"").split("/").pop())
             : ev.kind==="queue" ? ("queue "+(ev.op||"?"))
             : ev.kind==="system" && ev.ms ? ((ev.label||"turn")+" "+(ev.ms/1000).toFixed(1)+"s")
             : (ev.label||ev.kind);
    row.innerHTML='<span class="ts">'+hhmm(ev.t)+'</span><span class="nm">'+esc(name)+'</span>'+
                  (ev.agent?'<span class="sd">'+esc(ev.agent)+'</span>':(ev.sidechain?'<span class="sd">sub</span>':''));
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

  /* Signals about the session rather than about one call. They are handled
     before the per-droid routing because none of them belongs to a droid:
     they describe the room. */
  function sessionSignal(ev, silent){
    if(ev.kind === "cost"){
      live.cost = ev.cost;
      if(workshop.userData.ledger) workshop.userData.ledger.set(ev.cost);
      return true;
    }
    if(ev.kind === "file"){
      if(!ev.path) return true;   // malformed: count nothing, break nothing
      if(workshop.userData.tiles){
        workshop.userData.tiles.touch(ev.path);
        live.files = workshop.userData.tiles.count();
      }
      live.lastFile = String(ev.path).split("/").pop();
      return true;
    }
    if(ev.kind === "queue"){
      if(ev.op === "enqueue") live.queue++;
      else if(ev.op === "popAll") live.queue = 0;
      else live.queue = Math.max(0, live.queue - 1);
      return true;
    }
    if(ev.kind === "mode"){
      live.perm = ev.label || "—";
      return false;                       // still routes to a module
    }
    if(ev.kind === "system" && ev.label === "turn_duration" && ev.ms){
      live.turns++; live.turnMs = ev.ms;
      if(!silent) turnRing(ev.ms);
      return false;
    }
    return false;
  }

  var rebuilding = false;   // true while replay re-applies history
  function handle(ev, silent){
    // record once, on the way in. Skipped during a rebuild, or history
    // would grow by its own length every time you scrub.
    if(!rebuilding) histPush(ev);
    live.events++;
    live.lastAt = Date.now();
    // wake-up snap: a live event after long silence startles it awake
    if(sleepAmt > 0.5 && !silent){
      sleepAmt = 0;
      turnDome(MAIN, Math.PI*2);
      SOUND.chirp(2, voiceRate(live.model));
    }
    if(ev.model) live.model = ev.model;
    if(ev.tokens) live.tokens += ev.tokens;
    if(ev.cache) live.cache += ev.cache;
    if(ev.fresh) live.fresh += ev.fresh;
    if(ev.effort) live.effort = ev.effort;
    if(ev.speed) live.speed = ev.speed;
    if(ev.sidechain) live.sidechains++;
    if(ev.kind==="tool") live.lastTool = ev.tool;
    if(ev.kind==="result" && ev.error) live.errors++;

    if(sessionSignal(ev, silent)){ if(!silent) pushTick(ev, false); return; }

    /* Prose from the model with no subagent behind it is the session
       addressing YOU. It is the only event here aimed outward, so it gets
       the one outward gesture: a sonar ping off the droid. */
    if(ev.kind === "text" && !ev.sidechain && !ev.agent){
      talkUntil = Date.now() + TALK_MS;   // holds through replay too: honest state
      if(!silent) sonarReq = true;        // ...but rings only fire live, not on replay
    }

    if(ev.agent && ev.kind==="tool" && ev.tool==="Task"){
      lastTask = { agent: ev.agent, at: Math.min(Date.now(), ev.t || Date.now()) };
    }

    if(ev.agent){
      var A = ensureAgent(ev.agent, ev.model, ev.t);
      if(!A){ if(!silent) pushTick(ev, false); return; }
      A.lastAt = Math.min(Date.now(), ev.t || Date.now());
      if(ev.model) A.model = ev.model;
      if(ev.tokens) A.tokens += ev.tokens;
      if(ev.kind === "tool"){ A.lastTool = ev.tool; A.tools++; }
      else if(ev.kind === "result" && ev.error){ A.errors++; }
      if(ev.atype){ A.atype = ev.atype; A.el.querySelector(".atype").textContent = ev.atype; }
      // the model is only known once a model-bearing event arrives
      if(ev.model){
        var want = seriesFor(ev.model);
        if(want !== A.series) buildAgentBody(A, want);
      }
      if(ev.kind==="tool"){
        A.el.dataset.err="0";
        A.el.querySelector(".what").textContent = ev.tool;
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
      if(!silent){
        if(ev.kind === "tool" && SOUND.gate("tool", 260)) SOUND.tick();
        else if(ev.kind === "result" && ev.error && SOUND.gate("buzz", 600)) SOUND.buzz();
      }
      route(ev, A.mod, A.r2);
      bump(MOD,"vck",0.10);
    } else {
      if(ev.kind==="system" && ev.label === "compact_boundary"){
        chargeUntil = Date.now() + CHARGE_MS;
      }
      if(ev.kind==="system" && /turn_duration|stop_hook_summary/.test(ev.label||"")){
        mainTurnEnded = true;          // turn closed: the ball is in our court
      } else if(ev.kind!=="mode" && ev.kind!=="title"){
        mainTurnEnded = false;
      }
      if(ev.kind==="tool") pendStart(mainPend, ev);
      else if(ev.kind==="result") pendEnd(mainPend, ev);
      if(!silent){
        if(ev.kind === "tool"){
          if(ev.tool === "Task" || ev.tool === "Agent") SOUND.chirp(3, voiceRate(live.model));   // a droid is born
          else if(SOUND.gate("tool", 260)) SOUND.tick();
        }
        else if(ev.kind === "user" && !ev.sidechain && SOUND.gate("user", 900)) SOUND.blip(false);
        else if(ev.kind === "title" && SOUND.gate("title", 1500)) SOUND.blip(true);
        else if(ev.kind === "result" && ev.error && SOUND.gate("buzz", 600)) SOUND.buzz();
      }
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
    live.cache=0; live.fresh=0; live.effort="—"; live.speed="—";
    live.perm="—"; live.files=0; live.lastFile="—"; live.queue=0;
    live.turns=0; live.turnMs=0; live.cost=null;
    // animation state too: without this the droid keeps talking (or stays
    // asleep, and fakes a wake-up) with the previous session's state
    talkUntil=0; talkAmt=0; thinkAmt=0; sleepAmt=0; chargeUntil=0;
    lastTagKey=""; lastMainStatus=null; roam.held=false;
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
    es.addEventListener("ready", function(){ setLink("1","listening"); SOUND.blip(true); });
    es.addEventListener("events", function(e){
      // queued, not fired: the loop paces them out
      QUEUE.push.apply(QUEUE, JSON.parse(e.data));
    });
    es.addEventListener("beat", function(){});
    es.onerror=function(){
      SOUND.blip(false);
      setLink("err","reconnecting…");
      if(es){ es.close(); es=null; }
      retry=setTimeout(function(){ connect(path); }, 3000);
    };
  }

  sel.addEventListener("change", function(){ connect(sel.value); });
  loadSessions();

  /* --- rotate: a wall display cycling the sessions that are awake ------
     Built for a screen left on in the corner of a room. Only sessions
     that moved inside ACTIVE_WINDOW are in the rotation, so a machine
     that has been idle all afternoon shows the one session still going
     rather than flicking through forty dead ones. */
  var ACTIVE_WINDOW = 60 * 1000;      // "doing something" means: moved within a minute
  var DWELL = 25 * 1000;              // how long to watch each one
  var rotate = { on:false, until:0, list:[] };

  /* Sessions that moved inside the window, newest activity first. Split
     out with an explicit clock because the window is what decides whether
     the wall shows live work or flicks through dead sessions, and getting
     it wrong looks like a stuck picture rather than an error. */
  function activeIn(list, nowMs, windowMs){
    return list.filter(function(s){ return nowMs - (s.mtime || 0) < windowMs; });
  }
  function activeFrom(list){
    return activeIn(list, Date.now(), ACTIVE_WINDOW);
  }
  /* Never cut away mid-sentence: a droid that is talking or holding a
     question is the most watchable moment there is, and switching then
     makes the wall look broken rather than busy. */
  function safeToSwitch(){
    if(replay.on || rec.on) return false;
    if(isAsk(mainPend)) return false;
    if(Date.now() < talkUntil) return false;
    return true;
  }
  function rotateStep(list){
    if(!rotate.on) return;
    var act = activeFrom(list);
    rotate.list = act;
    syncRotateUI();
    if(act.length < 2) return;             // nothing to rotate between
    if(Date.now() < rotate.until) return;
    if(!safeToSwitch()){                   // try again shortly
      rotate.until = Date.now() + 4000;
      return;
    }
    var here = act.findIndex(function(s){ return s.path === sel.value; });
    var next = act[(here + 1) % act.length];
    if(next && next.path !== sel.value){
      sel.value = next.path;
      connect(next.path);
    }
    rotate.until = Date.now() + DWELL;
  }

  function refreshSessions(){
    if(document.activeElement===sel && !rotate.on) return;
    var keep=sel.value;
    fetch("/api/sessions?limit=40").then(function(r){return r.json();}).then(function(list){
      if(!list.length || !sel.options.length) return;
      if(list[0].path !== sel.options[0].value) fillSelect(list, keep);
      rotateStep(list);
    }).catch(function(){});
  }
  // 30 s is right for keeping the picker fresh; rotation needs to react
  // sooner than that, so it polls faster once it is on.
  setInterval(function(){ if(!rotate.on) refreshSessions(); }, 30000);
  setInterval(function(){ if(rotate.on) refreshSessions(); }, 5000);

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

  btnPanel=document.getElementById("btn-panel");
  btnPanel.addEventListener("click",function(){ showReadout(!readoutOpen); });
  showReadout(true);

  function syncRoam(){ btnRoam.setAttribute("aria-pressed", roamOn?"true":"false"); savePrefs(); }
  btnRoam.addEventListener("click",function(){ roamOn=!roamOn; syncRoam(); });

  var shopOn = true;
  function syncShop(){
    btnShop.setAttribute("aria-pressed", shopOn?"true":"false");
    workshop.visible = shopOn;
    savePrefs();
  }
  btnShop.addEventListener("click",function(){
    shopOn=!shopOn; syncShop();
    if(!shopOn){ closeStation(); hovered=null; hintEl.style.display="none"; }
  });

  function syncSpin(){ btnSpin.setAttribute("aria-pressed", autoSpin?"true":"false"); savePrefs(); }
  btnSpin.addEventListener("click",function(){ autoSpin=!autoSpin; syncSpin(); });

  var scanOn=!reduce;
  function syncScan(){
    btnScan.setAttribute("aria-pressed",scanOn?"true":"false");
    uniforms.uScan.value=scanOn?1:0;
    scanRing.visible=scanOn;
    savePrefs();
  }
  btnScan.addEventListener("click",function(){ scanOn=!scanOn; syncScan(); });
  btnReset.addEventListener("click",function(){
    cam.theta=HOME.theta; cam.phi=HOME.phi; cam.radius=HOME.radius; applyCamera();
  });
  /* --- recording ----------------------------------------------------
     MediaRecorder over the canvas stream. No library, no server round
     trip: the file is built in the page and handed to the browser. The
     container is whatever the browser will give us — webm nearly
     everywhere, mp4 on recent Safari — so the type is probed, not assumed. */
  var rec = { mr:null, chunks:[], on:false, startedAt:0 };
  function recMime(){
    if(typeof MediaRecorder === "undefined") return null;
    var want = ["video/webm;codecs=vp9", "video/webm;codecs=vp8",
                "video/webm", "video/mp4"];
    for(var i=0;i<want.length;i++){
      if(MediaRecorder.isTypeSupported(want[i])) return want[i];
    }
    return null;
  }
  function recStop(){
    if(!rec.on || !rec.mr) return;
    rec.mr.stop();                       // the rest happens in onstop
  }
  function recStart(){
    var mime = recMime();
    if(!mime){
      setLink("err", "recording unsupported");
      return;
    }
    var stream;
    try {
      stream = renderer.domElement.captureStream(30);
    } catch(e){
      setLink("err", "capture blocked");
      return;
    }
    rec.chunks = [];
    try {
      rec.mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
    } catch(e){
      setLink("err", "recorder failed");
      return;
    }
    rec.mr.ondataavailable = function(e){
      if(e.data && e.data.size) rec.chunks.push(e.data);
    };
    rec.mr.onstop = function(){
      var blob = new Blob(rec.chunks, { type: mime.split(";")[0] });
      var ext  = mime.indexOf("mp4") >= 0 ? "mp4" : "webm";
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement("a");
      var d    = new Date();
      a.href = url;
      a.download = "r2-holo-" + d.toISOString().slice(0,19).replace(/[:T]/g,"-") + "." + ext;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // let the download start before the blob goes away
      setTimeout(function(){ URL.revokeObjectURL(url); }, 10000);
      rec.on = false; rec.chunks = []; rec.mr = null;
      syncRecUI();
    };
    rec.mr.start(250);                  // timeslice: survive a long take
    rec.on = true;
    rec.startedAt = Date.now();
    syncRecUI();
  }
  var btnRec = document.getElementById("btn-rec");
  var recDot = document.getElementById("rec-dot");
  var recLabel = document.getElementById("rec-label");
  function syncRecUI(){
    btnRec.setAttribute("aria-pressed", rec.on ? "true" : "false");
    recDot.dataset.on = rec.on ? "1" : "0";
    recLabel.textContent = rec.on ? "Stop" : "Record";
  }
  btnRec.addEventListener("click", function(){
    if(rec.on) recStop(); else recStart();
  });
  if(typeof MediaRecorder === "undefined"){
    btnRec.disabled = true;
    btnRec.title = "This browser cannot record the canvas";
  }

  /* --- rotate control ------------------------------------------------ */
  var btnRotate = document.getElementById("btn-rotate");
  function syncRotateUI(){
    if(!btnRotate) return;   // called from the poll, which can beat this block
    btnRotate.setAttribute("aria-pressed", rotate.on ? "true" : "false");
    if(!rotate.on){ btnRotate.textContent = "Rotate"; return; }
    var n = rotate.list.length;
    btnRotate.textContent = n ? "Rotate " + n : "Rotate \u2014";
  }
  btnRotate.addEventListener("click", function(){
    rotate.on = !rotate.on;
    rotate.until = 0;                  // switch on the next poll, not in 25 s
    syncRotateUI();
    if(rotate.on) refreshSessions();
  });

  /* --- fullscreen ---------------------------------------------------
     Kiosk mode for a screen in the corner of the room. The browser also
     leaves fullscreen on its own (Esc, or the user swapping apps), so the
     button follows the fullscreenchange event rather than its own flag. */
  var btnFull = document.getElementById("btn-full");
  var appEl = document.getElementById("app");
  function fsElement(){
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }
  function toggleFullscreen(){
    if(fsElement()){
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      var go = appEl.requestFullscreen || appEl.webkitRequestFullscreen;
      if(!go){ btnFull.disabled = true; return; }
      // a rejected promise here just means the gesture was not trusted
      var r = go.call(appEl);
      if(r && r.catch) r.catch(function(){});
    }
  }
  function syncFull(){
    btnFull.setAttribute("aria-pressed", fsElement() ? "true" : "false");
    btnFull.textContent = fsElement() ? "Exit full" : "Fullscreen";
  }
  btnFull.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", syncFull);
  document.addEventListener("webkitfullscreenchange", syncFull);
  if(!(appEl.requestFullscreen || appEl.webkitRequestFullscreen)){
    btnFull.disabled = true;
    btnFull.title = "This browser cannot go fullscreen";
  }

  /* --- replay transport ------------------------------------------- */
  var transport = document.getElementById("transport");
  var btnReplay = document.getElementById("btn-replay");
  var btnPlay   = document.getElementById("btn-play");
  var btnSpeed  = document.getElementById("btn-speed");
  var btnLive   = document.getElementById("btn-live");
  var scrub     = document.getElementById("scrub");
  var tstamp    = document.getElementById("tstamp");
  var SPEEDS = [1, 2, 4, 8];

  function clockOf(ms){
    var d = new Date(ms);
    return String(d.getHours()).padStart(2,"0") + ":" +
           String(d.getMinutes()).padStart(2,"0") + ":" +
           String(d.getSeconds()).padStart(2,"0");
  }
  function syncReplayUI(){
    var span = histSpan();
    btnReplay.setAttribute("aria-pressed", replay.on ? "true" : "false");
    transport.dataset.open = replay.on ? "1" : "0";
    btnPlay.innerHTML = replay.playing ? "&#10074;&#10074;" : "&#9654;";
    btnSpeed.textContent = replay.speed + "\u00d7";
    if(!replay.on){
      scrub.value = 1000;
      tstamp.textContent = "live";
      return;
    }
    var total = Math.max(1, span[1] - span[0]);
    if(document.activeElement !== scrub){
      scrub.value = Math.round(((replay.at - span[0]) / total) * 1000);
    }
    tstamp.textContent = clockOf(replay.at);
  }
  btnReplay.addEventListener("click", function(){
    if(replay.on) exitReplay();
    else enterReplay(histSpan()[0]);
  });
  btnPlay.addEventListener("click", function(){
    if(!replay.on) return;
    replay.playing = !replay.playing;
    syncReplayUI();
  });
  btnSpeed.addEventListener("click", function(){
    var i = SPEEDS.indexOf(replay.speed);
    replay.speed = SPEEDS[(i + 1) % SPEEDS.length];
    syncReplayUI();
  });
  btnLive.addEventListener("click", exitReplay);
  scrub.addEventListener("input", function(){
    if(!replay.on) enterReplay();
    var span = histSpan();
    replay.at = span[0] + (scrub.value/1000) * Math.max(1, span[1]-span[0]);
    rebuildTo(replay.at);
    syncReplayUI();
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
  // view + drive keys. Skipped inside form controls so the session picker keeps working.
  document.addEventListener("keydown",function(e){
    var tag = e.target && e.target.tagName;
    if(tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
    keys[e.code] = true;
    if(e.code === "Digit1") setView("orbit");
    else if(e.code === "Digit2") setView("first");
    else if(e.code === "Digit3") setView("third");
    else if(e.code === "KeyV"){
      setView(viewMode === "orbit" ? "first" : viewMode === "first" ? "third" : "orbit");
    }
    // R re-anchors the freefly camera onto the droid
    else if(e.code === "KeyR" && viewMode === "orbit"){ flyRelease(); camGoal = null; }
    else if(e.code === "KeyF") toggleFullscreen();
    if(e.code === "Space" || e.code.indexOf("Arrow") === 0) e.preventDefault();
  });
  document.addEventListener("keyup",function(e){ keys[e.code] = false; });

  /* ===================================================================
     11a. SOUND — procedural R2 bleeps + room tone
     No samples: everything is synthesized with WebAudio, so the page stays
     offline and ships no licensed audio. Off until toggled — browsers only
     allow audio after a user gesture, and the toggle click is exactly that.
     =================================================================== */
  var SOUND = {
    on:false, ctx:null, master:null, ambNodes:null, lastWarble:0, _g:{},
    gate:function(key, ms){
      var now = Date.now();
      if(now - (this._g[key] || 0) < ms) return false;
      this._g[key] = now;
      return true;
    },
    // short tick for tool calls, pitch wandering so bursts don't drone
    tick:function(){
      var f = 1400 + Math.random()*1200;
      this.tone(f, f*1.4, 0.05, "sine", 0.10, 0);
    },
    ensure:function(){
      if(this.ctx) return true;
      var AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.16;
      this.master.connect(this.ctx.destination);
      return true;
    },
    toggle:function(){
      this.on = !this.on;
      if(this.on && this.ensure()){
        if(this.ctx.state === "suspended") this.ctx.resume();
        this.ambient(true);
        this.chirp(1);
      } else {
        this.on = false;
        this.ambient(false);
      }
      return this.on;
    },
    tone:function(f0, f1, dur, type, vol, when){
      if(!this.on || !this.ctx) return;
      var t0 = this.ctx.currentTime + (when || 0);
      var o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || "triangle";
      o.frequency.setValueAtTime(Math.max(30, f0), t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.5, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + dur + 0.05);
    },
    // R2 voice: fast syllables wandering between ~700 and ~2600 Hz.
    // rate bends the whole voice: R2 low, R4 plain, R5 sharp and out of tune.
    chirp:function(n, rate){
      if(!this.on) return;
      rate = rate || 1;
      var f = (900 + Math.random()*900)*rate, at = 0;
      for(var i=0; i<(n||3); i++){
        var f2 = (700 + Math.random()*1900)*rate;
        if(rate > 1.2) f2 += Math.random()*160-80;   // cut-price unit, tuned never
        var d = 0.06 + Math.random()*0.09;
        this.tone(f, f2, d, "square", 0.16, at);
        f = f2; at += d + 0.02 + Math.random()*0.05;
      }
    },
    warble:function(rate){
      rate = rate || 1;
      this.tone((1200+Math.random()*400)*rate, (600+Math.random()*300)*rate, 0.11, "sawtooth", 0.10, 0);
      this.tone((1800+Math.random()*600)*rate, 2400*rate, 0.07, "square", 0.08, 0.05);
    },
    buzz:function(){
      this.tone(160, 90, 0.28, "sawtooth", 0.28, 0);
      this.tone(113, 64, 0.28, "square", 0.18, 0.02);
    },
    blip:function(up){
      if(up){ this.tone(660, 990, 0.09, "sine", 0.25, 0); }
      else { this.tone(440, 220, 0.16, "sine", 0.22, 0); }
    },
    ambient:function(start){
      if(!this.ctx) return;
      if(!start){
        if(this.ambNodes){
          try{
            this.ambNodes.stop.forEach(function(n){ try{ n.stop(); }catch(e){} });
            this.ambNodes.g.disconnect();
          }catch(e){}
          this.ambNodes = null;
        }
        return;
      }
      if(this.ambNodes) return;
      var ctx = this.ctx;
      var g = ctx.createGain(); g.gain.value = 0.05; g.connect(this.master);
      var o1 = ctx.createOscillator(); o1.type = "sine"; o1.frequency.value = 55;
      var o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = 82.5;
      // air: looped noise through a lowpass, breathing slowly
      var len = ctx.sampleRate * 2;
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var ch = buf.getChannelData(0);
      for(var i=0;i<len;i++) ch[i] = Math.random()*2-1;
      var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320;
      var lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
      var lfoG = ctx.createGain(); lfoG.gain.value = 0.02;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      o1.connect(g); o2.connect(g); src.connect(lp); lp.connect(g);
      o1.start(); o2.start(); src.start(); lfo.start();
      this.ambNodes = { g:g, stop:[o1, o2, src, lfo] };
    }
  };
  // voice by series: R2 low, R4 plain, R5 sharp. Unknown model reads as R2.
  function voiceRate(model){
    var s = seriesFor(model || "");
    return s === "r5" ? 1.35 : s === "r4" ? 1.0 : 0.8;
  }
  var btnView=document.getElementById("btn-view");
  btnView.addEventListener("click",function(){
    setView(viewMode === "orbit" ? "first" : viewMode === "first" ? "third" : "orbit");
  });
  var btnSound=document.getElementById("btn-sound");
  btnSound.addEventListener("click",function(){
    soundArmed = false;
    btnSound.setAttribute("aria-pressed", SOUND.toggle() ? "true" : "false");
    savePrefs();
  });

  /* ===================================================================
     11b. PROJECTED PROPS
     A tool call is not only a pose. The droid projects the thing it is
     working on, and the prop lives for exactly as long as the call does:
     it is spawned by pendStart and dissolved by pendEnd, so it can never
     drift out of sync with what is really happening.
     =================================================================== */
  function propFor(tool){
    if(!tool) return null;
    // No fixture for this one on purpose: asking is not bench work, and
    // STATIONS has no "ask" entry, so the droid stays where it is and holds
    // the question up instead of driving off to a workshop station.
    if(ASK_TOOLS.test(tool)) return "ask";
    if(/^(Read|NotebookRead)$/.test(tool)) return "read";
    if(/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) return "write";
    if(/^(Grep|Glob|LS|TodoRead|TodoWrite)$/.test(tool)) return "index";
    if(/^(Bash|BashOutput|KillShell|KillBash)$/.test(tool)) return "term";
    if(/^(WebSearch|WebFetch)$/.test(tool) || tool.indexOf("mcp__")===0) return "globe";
    return null;
  }

  function rectGeo(w,h){
    var g=new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([
      -w/2,-h/2,0,  w/2,-h/2,0,   w/2,-h/2,0,  w/2, h/2,0,
       w/2, h/2,0, -w/2, h/2,0,  -w/2, h/2,0, -w/2,-h/2,0
    ],3));
    return g;
  }
  function segGeo(x1,y1,x2,y2){
    var g=new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([x1,y1,0, x2,y2,0],3));
    return g;
  }

  function buildProp(kind){
    var g = new THREE.Group(), mats = [], rows = [], extra = {};
    function M(op, col){
      var m = lineMaterial(col===undefined?PROJ:new THREE.Color(col), op);
      m.userData.base = op; mats.push(m); return m;
    }
    function add(geo, m){ var o=new THREE.LineSegments(geo,m); g.add(o); return o; }

    if(kind === "ask"){
      // The Leia panel: a question bar over a short list of choices. No text
      // — the transcript's wording never leaves the disk — so it reads as
      // "a question with N options", and the sweep says it is waiting on you.
      add(rectGeo(1.9, 1.5), M(0.55));
      var qy = 0.46;
      add(segGeo(-0.72, qy, 0.72, qy), M(0.75, 0xbff4ff));      // the question
      add(segGeo(-0.72, qy-0.14, 0.34, qy-0.14), M(0.45));      // second line
      extra.opts = [];
      for(var oi=0; oi<3; oi++){
        var oy = 0.06 - oi*0.26;
        add(segGeo(-0.76, oy, -0.66, oy), M(0.55));             // the marker
        extra.opts.push(add(segGeo(-0.56, oy, -0.56 + (0.5 + (oi%3)*0.26), oy), M(0.42)));
      }
      extra.caret = add(rectGeo(0.07, 0.07), M(0.9, 0xbff4ff));
      // interlace: faint lines sweeping the plate, the giveaway of a beam
      extra.scans = [];
      for(var si=0; si<3; si++){
        extra.scans.push(add(segGeo(-0.95, 0, 0.95, 0), M(0.16, 0xbff4ff)));
      }
      // corner ticks: the plate looks framed rather than floating loose
      [[-0.95,0.75,1],[0.95,0.75,-1],[-0.95,-0.75,1],[0.95,-0.75,-1]].forEach(function(c){
        add(segGeo(c[0], c[1], c[0]+c[2]*0.22, c[1]), M(0.6));
      });
      // the beam itself: four rays converging below the plate, where the
      // projector sits. Without these it is a floating sign, not a projection.
      extra.beam = [];
      [[-0.95,-0.75],[-0.32,-0.75],[0.32,-0.75],[0.95,-0.75]].forEach(function(p){
        extra.beam.push(add(segGeo(p[0], p[1], 0, -2.15), M(0.14, 0xbff4ff)));
      });
    } else if(kind === "read" || kind === "write"){
      // a document page, read by a travelling scan bar or written line by line
      add(rectGeo(1.5, 1.95), M(0.55));
      add(segGeo(-0.75, 0.72, 0.75, 0.72), M(0.30));       // header rule
      for(var i=0;i<12;i++){
        var len = 0.55 + Math.random()*0.75;
        var y = 0.55 - i*0.115;
        rows.push(add(segGeo(-0.62, y, -0.62+len, y), M(0.42)));
      }
      extra.scan = add(segGeo(-0.72, 0, 0.72, 0), M(0.9, 0xbff4ff));
      extra.dot  = add(rectGeo(0.09, 0.09), M(0.9, 0xbff4ff));

    } else if(kind === "term"){
      // a shell panel: lines scroll up under a blinking cursor
      add(rectGeo(2.3, 1.35), M(0.55));
      add(segGeo(-1.15, 0.50, 1.15, 0.50), M(0.30));
      for(var j=0;j<7;j++){
        var l2 = 0.4 + Math.random()*1.5;
        rows.push(add(segGeo(-1.02, 0.36 - j*0.16, -1.02+l2, 0.36 - j*0.16), M(0.40)));
      }
      extra.prompt = add(segGeo(-1.08, 0.62, -0.92, 0.62), M(0.8, 0xbff4ff));
      extra.cursor = add(rectGeo(0.10, 0.13), M(0.95, 0xbff4ff));

    } else if(kind === "index"){
      // a directory being swept by a search reticle
      add(rectGeo(2.25, 1.65), M(0.5));
      for(var r=0;r<4;r++) for(var c=0;c<3;c++){
        var cell = add(rectGeo(0.56, 0.26), M(0.30));
        cell.position.set(-0.68 + c*0.68, 0.52 - r*0.34, 0);
        rows.push(cell);
      }
      extra.reticle = add(rectGeo(0.66, 0.34), M(0.95, 0xbff4ff));

    } else {                                   // globe: anything off-hull
      var pts=[], R=0.78;
      for(var la=1; la<5; la++){                            // parallels
        var phi=(la/5)*Math.PI, rr=Math.sin(phi)*R, yy=Math.cos(phi)*R, seg=30;
        for(var k2=0;k2<seg;k2++){
          var a0=(k2/seg)*Math.PI*2, a1=((k2+1)/seg)*Math.PI*2;
          pts.push(Math.cos(a0)*rr, yy, Math.sin(a0)*rr, Math.cos(a1)*rr, yy, Math.sin(a1)*rr);
        }
      }
      for(var me=0; me<6; me++){                            // meridians
        var ang=(me/6)*Math.PI, st2=22;
        for(var s2=0;s2<st2;s2++){
          var p0=(s2/st2)*Math.PI, p1=((s2+1)/st2)*Math.PI;
          pts.push(Math.sin(p0)*R*Math.cos(ang), Math.cos(p0)*R, Math.sin(p0)*R*Math.sin(ang));
          pts.push(Math.sin(p1)*R*Math.cos(ang), Math.cos(p1)*R, Math.sin(p1)*R*Math.sin(ang));
        }
      }
      var gg=new THREE.BufferGeometry();
      gg.setAttribute("position", new THREE.Float32BufferAttribute(pts,3));
      extra.globe = add(gg, M(0.42));

      var rp=[], seg3=64, RR=1.08;
      for(var i3=0;i3<seg3;i3++){
        var b0=(i3/seg3)*Math.PI*2, b1=((i3+1)/seg3)*Math.PI*2;
        rp.push(Math.cos(b0)*RR,0,Math.sin(b0)*RR, Math.cos(b1)*RR,0,Math.sin(b1)*RR);
      }
      var rg=new THREE.BufferGeometry();
      rg.setAttribute("position", new THREE.Float32BufferAttribute(rp,3));
      extra.ring = add(rg, M(0.7, 0xbff4ff));
      extra.ring.rotation.x = 0.5;
    }

    g.visible = false;
    scene.add(g);

    return {
      kind:kind, group:g, level:0, mats:mats, rows:rows, x:extra,
      setLevel: function(v){
        for(var i=0;i<mats.length;i++) mats[i].opacity = mats[i].userData.base * v;
      },
      update: function(dt, tt, age){
        var X = this.x;
        if(kind === "read"){
          var sy = 0.62 - ((tt*0.55) % 1) * 1.3;            // scan sweeps down
          X.scan.position.y = sy;
          X.dot.position.set(0.62, sy, 0);
          for(var i=0;i<rows.length;i++){
            var near = 1 - Math.min(1, Math.abs(rows[i].position.y + 0 - sy)*3);
            rows[i].material.opacity = rows[i].material.userData.base * this.level * (0.6 + near*1.6);
          }
        } else if(kind === "write"){
          var prog = Math.min(1, (age % 6) / 4.2);          // lines appear
          var cut = Math.floor(prog * rows.length);
          for(var w2=0; w2<rows.length; w2++){
            rows[w2].visible = w2 <= cut;
          }
          var cy = 0.55 - Math.min(rows.length-1, cut)*0.115;
          X.scan.position.y = cy;
          X.scan.scale.x = 0.12;
          X.dot.position.set(-0.1 + Math.sin(tt*9)*0.02, cy, 0);
        } else if(kind === "term"){
          var shift = ((tt*0.7) % 1) * 0.16;
          for(var q=0;q<rows.length;q++) rows[q].position.y = shift;
          X.cursor.position.set(-1.0 + ((tt*1.4)%1)*0.9, 0.62, 0);
          X.cursor.material.opacity =
            X.cursor.material.userData.base * this.level * (Math.sin(tt*7)>0 ? 1 : 0.15);
        } else if(kind === "index"){
          var cellI = Math.floor(tt*2.2) % rows.length;
          var cc = rows[cellI];
          X.reticle.position.copy(cc.position);
          for(var z2=0; z2<rows.length; z2++){
            var hit = (z2 % 5 === 0);
            rows[z2].material.opacity = rows[z2].material.userData.base * this.level *
              (z2===cellI ? 2.4 : (hit ? 1.5 : 1));
          }
        } else if(kind === "ask"){
          // Unstable projection: two sine waves of different periods beat
          // against each other so the flicker never falls into an obvious
          // loop, plus rare hard dropouts — a beam struggling to hold.
          // steady for reduced-motion: flicker is exactly what that setting
          // asks us not to do, and the panel reads fine without it
          var beat = 0.82 + 0.13*Math.sin(tt*5.3) + 0.07*Math.sin(tt*11.7);
          var drop = (Math.sin(tt*23.0) > 0.93) ? 0.45 : 1;   // brief cut-out
          var flick = reduce ? 1 : beat * drop;
          for(var fm=0; fm<mats.length; fm++){
            mats[fm].opacity = mats[fm].userData.base * this.level * flick;
          }
          // interlace lines crawl up the plate at staggered offsets
          for(var sc=0; sc<X.scans.length; sc++){
            var sp = reduce ? (sc+0.5)/X.scans.length     // parked, not crawling
                            : ((tt*0.32 + sc/X.scans.length) % 1);
            X.scans[sc].position.y = -0.75 + sp*1.5;
            X.scans[sc].material.opacity =
              X.scans[sc].material.userData.base * this.level * flick *
              (0.35 + 0.65*Math.sin(sp*Math.PI));          // fade at the edges
          }
          // the beam flickers harder than the plate: it is the unstable part
          for(var bm=0; bm<X.beam.length; bm++){
            X.beam[bm].material.opacity = X.beam[bm].material.userData.base *
              this.level * flick * (0.5 + 0.5*Math.sin(tt*7 + bm*1.3));
          }
          // caret walks the options and the one under it brightens: a cursor
          // waiting on a hand, not a progress bar
          var pick = Math.floor(tt*0.8) % X.opts.length;
          var oyy = 0.06 - pick*0.26;
          X.caret.position.set(-0.66, oyy, 0);
          X.caret.material.opacity = X.caret.material.userData.base * this.level *
            flick * (0.45 + 0.55*Math.abs(Math.sin(tt*3)));
          for(var ok=0; ok<X.opts.length; ok++){
            X.opts[ok].material.opacity = X.opts[ok].material.userData.base *
              this.level * flick * (ok === pick ? 2.2 : 1);
          }
        } else {
          X.globe.rotation.y += dt*0.6;
          X.ring.rotation.y  -= dt*0.9;
          X.ring.rotation.z   = Math.sin(tt*0.7)*0.25;
        }
      }
    };
  }

  /* Energy rings climbing the hull while it charges. */
  var CHARGE_RINGS = [];
  (function(){
    var pts=[], seg=40, R=1.25;
    for(var i=0;i<seg;i++){
      var a0=(i/seg)*Math.PI*2, a1=((i+1)/seg)*Math.PI*2;
      pts.push(Math.cos(a0)*R,0,Math.sin(a0)*R, Math.cos(a1)*R,0,Math.sin(a1)*R);
    }
    var g=new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts,3));
    for(var r=0;r<4;r++){
      var m=lineMaterial(new THREE.Color(0xbff4ff), 0);
      var o=new THREE.LineSegments(g,m);
      o.visible=false;
      scene.add(o);
      CHARGE_RINGS.push({obj:o, mat:m, off:r/4});
    }
  })();

  var propDir=new THREE.Vector3(), propRight=new THREE.Vector3(), propAnchor=new THREE.Vector3();
  /* Props are placed to the camera's right of their droid and billboarded,
     so they never end up hidden behind the unit that is projecting them. */
  function updateProps(store, flight, dt, tt, anchor, scale, mount){
    var kind = flight ? propFor(flight.tool) : null;
    if(kind && !store.props[kind]) store.props[kind] = buildProp(kind);
    camera.getWorldDirection(propDir);
    propRight.crossVectors(propDir, camera.up).normalize();
    var keys = Object.keys(store.props);
    for(var i=0;i<keys.length;i++){
      var P = store.props[keys[i]];
      var target = (keys[i] === kind) ? 1 : 0;
      P.level = damp(P.level, target, target ? 6 : 7, dt);
      if(P.level < 0.012){ P.group.visible = false; continue; }
      P.group.visible = true;
      P.setLevel(P.level);
      P.update(dt, tt, flight ? (Date.now()-flight.at)/1000 : 0);
      var isAskProp = (keys[i] === "ask");
      if(mount && !isAskProp){
        P.group.position.copy(mount);                    // mounted on a fixture
      } else if(isAskProp){
        // a question is held up in front, not filed away to one side, and it
        // rides higher so it clears the dome and reads as addressed to you
        propAnchor.copy(anchor)
          .addScaledVector(propRight, 0.35*scale)
          .setY(anchor.y + 4.15*scale);
        P.group.position.copy(propAnchor);
      } else {
        propAnchor.copy(anchor)
          .addScaledVector(propRight, 2.45*scale)
          .setY(anchor.y + 2.9*scale);
        P.group.position.copy(propAnchor);
      }
      P.group.lookAt(camera.position);
      var grow = isAskProp ? 1.75 : 1;                   // questions get room
      P.group.scale.setScalar(scale * grow * (0.35 + 0.65*easeOutBack(Math.min(1,P.level))));
      if(isAskProp && !reduce){
        // projector wobble: the whole plate drifts and breathes a little, so
        // it reads as a beam from the droid rather than a decal on the screen
        P.group.position.y += Math.sin(tt*2.3)*0.055*scale;
        P.group.rotation.z += Math.sin(tt*1.7)*0.012;
      }
    }
  }

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

  /* Toggle preferences persist in localStorage (per origin, so per port).
     Sound restores armed, not playing: the button shows pressed and the
     first click anywhere starts the context, because browsers need the
     gesture. Reduced motion always wins over a saved Scan=true. */
  var PREFS_KEY = "r2holo.prefs.v1", prefPanel = true, soundArmed = false;
  function savePrefs(){
    if(typeof PREFS_KEY === "undefined") return;   // syncs also run before this block is evaluated
    try{
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        panel:readoutOpen, shop:shopOn, roam:roamOn, spin:autoSpin,
        scan:scanOn, sound:(SOUND.on || soundArmed)
      }));
    }catch(e){}
  }
  function armSound(){
    soundArmed = true;
    btnSound.setAttribute("aria-pressed", "true");
    document.addEventListener("pointerdown", function kick(){
      document.removeEventListener("pointerdown", kick);
      if(soundArmed){ soundArmed = false; btnSound.click(); }
    });
  }
  function loadPrefs(){
    var p = null;
    try{ p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); }catch(e){}
    if(!p || typeof p !== "object") return;
    if(typeof p.shop === "boolean") shopOn = p.shop;
    if(typeof p.roam === "boolean") roamOn = p.roam;
    if(typeof p.spin === "boolean") autoSpin = p.spin;
    if(typeof p.scan === "boolean" && !reduce) scanOn = p.scan;
    if(typeof p.panel === "boolean") prefPanel = p.panel;
    if(p.sound) armSound();
  }

  loadPrefs();
  applyCamera(); select(SYSTEMS[0].id); syncRoam(); syncShop(); syncSpin(); syncScan();
  showReadout(prefPanel);
  markShared();

  var clock=new THREE.Clock();
  var beamTarget=new THREE.Vector3(), tmpVec=new THREE.Vector3();

  /* The poll delivers a batch every 1.2 s, so firing them all on one frame
     produces a spike followed by dead air. Spreading the batch across the
     interval turns it back into a sequence you can actually read. */
  /* --- history and replay -------------------------------------------
     Every event that has ever been applied, kept in arrival order. State
     here is cumulative (tokens, counters, live droids) and handle() has no
     inverse, so scrubbing backwards is done by resetting and re-applying
     from the start up to the chosen instant — slow-looking, but it is the
     only way to land on a state that is actually correct. */
  var HIST = [], HIST_CAP = 20000;
  var replay = { on:false, at:0, speed:1, playing:true, acc:0 };
  function histPush(ev){
    HIST.push(ev);
    if(HIST.length > HIST_CAP) HIST.splice(0, HIST.length - HIST_CAP);
  }
  function histSpan(){
    if(!HIST.length) return [0, 0];
    return [HIST[0].t || 0, HIST[HIST.length-1].t || 0];
  }
  /* How many leading events fall at or before tMs. History is already in
     time order, so this is the cut point for a rebuild. Split out because
     an off-by-one here silently replays the wrong world. */
  function histCount(hist, tMs){
    var n = 0;
    for(var i=0; i<hist.length; i++){
      if((hist[i].t || 0) > tMs) break;
      n++;
    }
    return n;
  }

  var QUEUE=[], qAcc=0;
  function drainQueue(dt){
    // In replay the present must not be shown, but it must not be lost
    // either: park arriving events straight into history so the timeline
    // keeps growing and exiting replay lands on a current world.
    if(replay.on){
      while(QUEUE.length) histPush(QUEUE.shift());
      return;
    }
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

  function enterReplay(atMs){
    if(!HIST.length) return;
    var span = histSpan();
    replay.on = true;
    replay.playing = true;
    replay.at = (atMs === undefined) ? span[0] : clamp(atMs, span[0], span[1]);
    rebuildTo(replay.at);
    syncReplayUI();
  }
  function exitReplay(){
    if(!replay.on) return;
    replay.on = false;
    replay.playing = true;
    // live state is whatever the full history says, which is where the
    // stream will carry on from
    var span = histSpan();
    rebuildTo(span[1]);
    syncReplayUI();
  }

  /* Rebuild the world as it stood at time T. resetAll() clears the droids
     and counters, then every event up to T is re-applied silently (no
     sound, no wake-up snaps — this is a reconstruction, not live news). */
  function rebuildTo(tMs){
    rebuilding = true;
    resetAll();
    QUEUE.length = 0; qAcc = 0;
    mainPend = {};
    var n = histCount(HIST, tMs);
    for(var i=0; i<n; i++) handle(HIST[i], true);
    // the tail of the ticker is what a human reads first: refill it
    var from = Math.max(0, n-9);
    for(var k=from; k<n; k++) pushTick(HIST[k], true);
    rebuilding = false;
    renderReadout();
    return n;
  }

  /* Replay advances its own clock over the recorded span. At the right
     edge it hands control back to the live stream. */
  function stepReplay(dt){
    if(!replay.on || !replay.playing) return;
    var span = histSpan();
    replay.at += dt * 1000 * replay.speed;
    if(replay.at >= span[1]){          // caught up: back to live
      replay.at = span[1];
      exitReplay();
      return;
    }
    replay.acc += dt;
    if(replay.acc >= 0.1){             // 10 Hz is plenty for a rebuild
      replay.acc = 0;
      rebuildTo(replay.at);
      syncReplayUI();
    }
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
    stepReplay(dt);

    var decay = Math.exp(-1.9*dt);
    MODKEYS.forEach(function(k){ MOD[k].p *= decay; });

    /* Three states, and only one of them is actually "nothing happening":
       a call in flight, a wait on the model, or a truly idle session. */
    var inflight = applyPending(mainPend, MOD);
    var sinceLast = nowMs - (live.lastAt || 0);
    var waiting = !inflight && live.lastAt && sinceLast < WAIT_WINDOW;
    if(waiting) MOD.int.p = Math.max(MOD.int.p, 0.20);
    // talking beats waiting: prose landing means the model is answering, not thinking
    var talking = !inflight && !(nowMs < chargeUntil) && nowMs < talkUntil;
    talkAmt = damp(talkAmt, talking ? 1 : 0, 5, dt);
    // thinking = the model is working but no call is open (the gap between a
    // result landing and the next move) — or the only open call is a Task
    // handed to a subagent, during which the parent would otherwise sit
    // frozen on RUNNING for minutes. Drives the LED chase, not the lamps:
    // amber stays the settled "waiting on the model" level underneath.
    var delegated = !!(inflight && /^(Task|Agent)$/.test(inflight.tool || ""));
    var thinking = (waiting || delegated) && !talking && !(nowMs < chargeUntil);
    thinkAmt = damp(thinkAmt, thinking ? 1 : 0, 5, dt);
    // long sleep after minutes of nothing: a slow fall, not a switch
    var sleeping = !!(live.lastAt && nowMs - live.lastAt > SLEEP_AFTER);
    sleepAmt = damp(sleepAmt, sleeping ? 1 : 0, 1.5, dt);
    if(sleepAmt > 0.7 && SOUND.gate("sleep", 25000)) SOUND.chirp(1, voiceRate(live.model));
    if(talkAmt > 0.5 && nowMs - SOUND.lastWarble > 1100){
      SOUND.lastWarble = nowMs; SOUND.warble(voiceRate(live.model));
    }
    var idle = !inflight && !waiting && !talking;

    /* If the bay is up and the tool has a station, that fixture is where the
       work happens: the droid drives there and the prop mounts on it. */
    var charging = nowMs < chargeUntil;
    var stKind = inflight ? propFor(inflight.tool) : null;
    var station = (shopOn && stKind && workshop.userData.stations)
                    ? workshop.userData.stations[stKind] : null;
    if(charging && workshop.userData.stations){
      station = workshop.userData.stations.charge;   // docking wins
    }

    var errRecent = MOD.ext.p > 0.25;
    var asking = isAsk(mainPend) || (!inflight && mainTurnEnded);
    setLamps(MAIN, {err:errRecent && !charging, ask:asking && !charging,
                    wait:(waiting || charging) && !asking,
                    idle:idle && !asking && !charging}, dt);

    var status = charging
      ? { head:"RECHARGING", label:"context compaction",
          secs:Math.round((chargeUntil-nowMs)/1000), mode:"charge" }
      : inflight
      ? { head:"RUNNING", label:inflight.tool, secs:Math.round((nowMs-inflight.at)/1000), mode:"run" }
      : talking
      ? { head:"TALKING", label:"replying to you", secs:Math.round((talkUntil-nowMs)/1000), mode:"run" }
      : waiting
      ? { head:"WAITING ON MODEL", label:live.lastTool, secs:Math.round(sinceLast/1000), mode:"wait" }
      : { head:"IDLE", label:live.lastTool, secs:0, mode:"idle" };
    setMainTag(status);
    propAnchor.copy(droid.position);
    updateProps(mainProps, inflight, dt, t, propAnchor, 1,
                station ? station.mount : null);

    var ex = animateDroid(MAIN, MOD, t, dt, idle, talkAmt, thinkAmt);
    // asleep: head droops, lights dim to a quarter, but never fully out
    if(sleepAmt > 0.01){
      MAIN.dome.rotation.x += sleepAmt * 0.3;
      var dim = 1 - sleepAmt*0.75;
      MAIN.eyeMat.opacity *= dim;
      ["idle","wait","ask","err"].forEach(function(kk){
        MAIN.lamps[kk].opacity *= dim;
        MAIN.lamps[kk].userData.halo.opacity *= dim;
      });
      for(var li2=0; li2<MAIN.logic.length; li2++){
        MAIN.logic[li2].opacity *= dim;
        MAIN.logic[li2].userData.halo.opacity *= dim;
      }
    }

    /* --- patrol: pick a spot, roll to it, park in the middle when idle --- */
    // A real question (not just a finished turn) pins it in place: it is
    // waiting on you, and wandering off mid-question reads as indifference.
    // Only this droid stops — the rest of the bay carries on working.
    var askPin = isAsk(mainPend);
    if(askPin){
      if(!roam.held){ roam.held = true; roam.hold.set(roam.pos.x, 0, roam.pos.z); }
      roam.target.copy(roam.hold);
    } else if(station){
      roam.target.copy(station.stand);
      roam.next = 2.5;                       // resume wandering once it ends
    } else if(charging){
      roam.target.set(0, 0, 13.2);           // dock even with the bay hidden
    } else if(sleepAmt > 0.5){
      // asleep: stay where it dropped. Latch the spot once — copying the
      // live pos every frame lets the damp drift it across the floor.
      if(!roam.held){ roam.held = true; roam.hold.set(roam.pos.x, 0, roam.pos.z); }
      roam.target.copy(roam.hold);
    } else if(roamOn && !idle){
      roam.next -= dt;
      if(roam.next <= 0){
        var ra = Math.random()*Math.PI*2, rr = 3.4 + Math.random()*2.8;
        roam.target.set(Math.cos(ra)*rr, 0, Math.sin(ra)*rr);
        roam.next = 6 + Math.random()*9;
      }
    } else {
      // done working: hold the last spot instead of trekking back to the
      // middle — where it stopped is where the last job was. A slow sway
      // keeps it from reading as frozen.
      if(!roam.held){
        roam.held = true;
        roam.hold.set(roam.pos.x, 0, roam.pos.z);
      }
      var swayA = reduce ? 0 : 0.2;
      roam.target.set(
        roam.hold.x + Math.sin(t*0.5)*swayA,
        0,
        roam.hold.z + Math.cos(t*0.37)*swayA
      );
    }
    // askPin excluded: it owns roam.held while the question is open, and the
    // tool in flight would otherwise clear the latch on every frame
    if(!askPin && (station || charging || (roamOn && !idle))) roam.held = false;

    // light the station he is working at, dim the rest
    if(workshop.userData.stations){
      var SS = workshop.userData.stations, seen = {};
      Object.keys(SS).forEach(function(k){
        var St = SS[k];
        if(!St || seen[St.kind]) return;
        seen[St.kind] = 1;
        // lit for whoever is working there: the primary, or a subagent that
        // booked it. The claim map is last frame's — a frame behind is
        // invisible, and it keeps the bench from going dark under a subagent.
        var inUse = (station === St) || (prevClaimed[St.kind] !== undefined);
        St.lit = damp(St.lit, inUse ? 1 : 0, 5, dt);
        St.mat.opacity = St.lit * (0.28 + 0.22*(0.5+0.5*Math.sin(t*2.4)));
        St.ring.visible = St.lit > 0.02;
      });
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
    if(askPin && !reduce){
      // turn to face whoever is being asked, and hold the dome square on
      var toCam = Math.atan2(camera.position.x - roam.pos.x,
                             camera.position.z - roam.pos.z);
      // same wrap as the patrol turn above: take the short way round, never
      // the long spin through ±π
      var aturn = ((toCam - roam.heading + Math.PI*3) % (Math.PI*2)) - Math.PI;
      roam.heading += aturn * (1 - Math.exp(-3*dt));
      droid.rotation.y = roam.heading;
      MAIN.domeTarget = damp(MAIN.domeTarget, 0, 3, dt);
    }
    if(charging){                     // docked: faces the arch, sits low
      MAIN.squash.scale.y = damp(MAIN.squash.scale.y, 0.94, 4, dt);
      MAIN.domeTarget = damp(MAIN.domeTarget, 0, 3, dt);
    }

    // --- 1st person: set camera BEFORE stepMe so the forward vector is fresh ---
    if(viewMode === "first"){
      camera.position.set(me.pos.x, me.pos.y + 2.8, me.pos.z);
      var cp = Math.cos(fpPitch);
      camera.lookAt(
        camera.position.x + Math.sin(fpYaw)*cp,
        camera.position.y + Math.sin(fpPitch),
        camera.position.z + Math.cos(fpYaw)*cp);
      camera.updateMatrixWorld();
    }

    // keep him loosely framed instead of letting him wander out of shot
    if(viewMode === "third" || viewMode === "first") stepMe(dt, t);
    if(viewMode === "third"){
      // auto-position camera behind the ball: use damp() for the absolute
      // angle so it settles without oscillating
      var msp = Math.sqrt(me.vel.x*me.vel.x + me.vel.z*me.vel.z);
      if(!drag){
        var behindAngle = msp > 0.15
          ? Math.atan2(-me.vel.x, -me.vel.z)        // behind the velocity
          : -meGroup.rotation.y;                      // behind the ball's facing
        cam.theta = damp(cam.theta, behindAngle, 3, dt);
      }
      cam.target.x = damp(cam.target.x, me.pos.x, 4, dt);
      cam.target.y = damp(cam.target.y, me.pos.y+1.2, 4, dt);
      cam.target.z = damp(cam.target.z, me.pos.z, 4, dt);
    } else if(viewMode === "orbit"){
      stepFly(dt);
      if(!flyOn){          // hands off the keys: drift back to framing the droid
        cam.target.x = damp(cam.target.x, roam.pos.x*0.55, 1.6, dt);
        cam.target.y = damp(cam.target.y, 3.4, 1.6, dt);
        cam.target.z = damp(cam.target.z, roam.pos.z*0.55, 1.6, dt);
      }
    } else {
      cam.target.x = damp(cam.target.x, roam.pos.x*0.55, 1.6, dt);
      cam.target.y = damp(cam.target.y, 3.4, 1.6, dt);
      cam.target.z = damp(cam.target.z, roam.pos.z*0.55, 1.6, dt);
    }
    if(camGoal && performance.now() > camGoal.until) camGoal = null;
    if(camGoal && flyOn) flyRelease();   // right-click focus wins over freefly
    if(camGoal && viewMode !== "third"){
      cam.target.x = damp(cam.target.x, camGoal.x, 1.6, dt);
      cam.target.z = damp(cam.target.z, camGoal.z, 1.6, dt);
      cam.radius = damp(cam.radius, camGoal.r, 1.6, dt);
    }
    if(viewMode !== "first") applyCamera();

    alarmEl.style.opacity = (ex*0.45).toFixed(3);

    /* --- subagent droids --- */
    // One droid per fixture. The primary books first (it was here already),
    // then subagents in id order; whoever misses out works from its own slot.
    var claimed = {};
    if(station) claimed[station.kind] = "main";
    var ids = Object.keys(AGENTS);
    var newest = null, newestT = 0;
    for(var ai=0; ai<ids.length; ai++){
      var A=AGENTS[ids[ai]];
      MODKEYS.forEach(function(k){ A.mod[k].p *= decay; });
      var aFlight = applyPending(A.pend, A.mod);
      var aSince = nowMs - A.lastAt;
      var aWait = !aFlight && aSince < WAIT_WINDOW;
      var aIdle = !aFlight && !aWait;
      var aAsk = isAsk(A.pend);
      setLamps(A.r2, { err: A.mod.ext.p > 0.25, ask: aAsk,
                       wait: aWait && !aAsk, idle: aIdle && !aAsk }, dt);
      updateProps(A, aFlight, dt, t, A.wrap.position, A.targetScale/0.52);
      var aMode = aFlight ? "run" : (aAsk ? "ask" : (aWait ? "wait" : "idle"));
      var aSecs = aFlight ? Math.round((nowMs - aFlight.at)/1000)
                          : Math.round(aSince/1000);
      var aKey = aMode + "|" + (aFlight ? aFlight.tool : "") + "|" + aSecs;
      A.mode = aMode; A.secs = aSecs;
      if(aKey !== A.tagKey){
        A.tagKey = aKey;
        A.el.dataset.mode = aMode;
        if(aFlight) A.el.querySelector(".what").textContent = aFlight.tool;
        A.el.querySelector(".secs").textContent = aSecs > 1 ? aSecs + "s" : "";
      }
      animateDroid(A.r2, A.mod, t, dt, aIdle, 0, aWait ? 1 : 0);
      A.r2.group.position.set(A.r2.shake.x, 0, A.r2.shake.z);

      /* They patrol their own patch too, otherwise they read as frozen next
         to a primary that moves. A child's patch travels with its parent. */
      var PA = A.parent && AGENTS[A.parent];
      var bx = PA ? PA.wrap.position.x + A.anchor.x : A.anchor.x;
      var bz = PA ? PA.wrap.position.z + A.anchor.z : A.anchor.z;

      /* Working at a fixture? Go stand at it, like the primary does — but
         only if nobody booked it this frame, otherwise queue at home. */
      var aStKind = aFlight ? propFor(aFlight.tool) : null;
      var aSt = (shopOn && aStKind && workshop.userData.stations)
                  ? workshop.userData.stations[aStKind] : null;
      if(aSt && canClaim(claimed[aSt.kind], prevClaimed[aSt.kind], ids[ai])){
        claimed[aSt.kind] = ids[ai];
        // offset off the bench so it parks beside the primary's spot, not in it
        var aoff = (A.slot % 2) ? 1.1 : -1.1;
        bx = aSt.stand.x + aoff;
        bz = aSt.stand.z + 0.9;
        A.atStation = true;
      } else {
        A.atStation = false;
      }
      // aAsk pins it too: only the droid with the question stops, the rest
      // of the bay keeps working around it
      if(!aIdle && !reduce && !A.atStation && !aAsk){
        A.rnext -= dt;
        if(A.rnext <= 0){
          A.woff.set((Math.random()-0.5)*1.9, 0, (Math.random()-0.5)*1.9);
          A.rnext = 4 + Math.random()*7;
        }
      } else {
        A.woff.multiplyScalar(Math.exp(-0.9*dt));
      }
      var apx=A.wrap.position.x, apz=A.wrap.position.z;
      A.wrap.position.x = damp(A.wrap.position.x, bx + A.woff.x, 1.1, dt);
      A.wrap.position.z = damp(A.wrap.position.z, bz + A.woff.z, 1.1, dt);
      var avx=(A.wrap.position.x-apx)/Math.max(dt,1e-4);
      var avz=(A.wrap.position.z-apz)/Math.max(dt,1e-4);
      var wantY;
      if(aAsk){                                  // asking: face whoever must answer
        wantY = Math.atan2(camera.position.x - A.wrap.position.x,
                           camera.position.z - A.wrap.position.z);
      } else if(Math.sqrt(avx*avx+avz*avz) > 0.05){
        wantY = Math.atan2(avx, avz);            // look where you are going
      } else {                                   // otherwise face who sent you
        var fx = PA ? PA.wrap.position.x : droid.position.x;
        var fz = PA ? PA.wrap.position.z : droid.position.z;
        wantY = Math.atan2(fx - A.wrap.position.x, fz - A.wrap.position.z);
      }
      var da = ((wantY - A.hd + Math.PI*3) % (Math.PI*2)) - Math.PI;
      A.hd += da * (1 - Math.exp(-4*dt));
      A.wrap.rotation.y = A.hd;

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
    prevClaimed = claimed;   // next frame's bench lights read this

    /* --- the VicksVisc beam aims at whichever droid worked last --- */
    if(MAIN.beam){
      var want = newest && (nowMs - newestT) < 12000;
      var op = want ? Math.min(0.20, 0.07 + MOD.vck.p*0.22) : 0;
      MAIN.beamMat.opacity = damp(MAIN.beamMat.opacity, op, 6, dt);
      // Cheap context reuse keeps the beam cyan; context being paid for again
      // pulls it amber. Same channel as the extinguisher on purpose: both mean
      // "this is costing you something".
      MAIN.beamMat.color.copy(AMBER).lerp(PROJ, clamp(cacheRatio(), 0, 1));
      MAIN.beam.visible = MAIN.beamMat.opacity > 0.01;
      if(MAIN.beam.visible && newest){
        beamTarget.set(0, 2.2*newest.wrap.scale.x/newest.targetScale, 0);
        newest.wrap.localToWorld(beamTarget);
        MAIN.beam.lookAt(beamTarget);
        var d = MAIN.beam.getWorldPosition(tmpVec).distanceTo(beamTarget);
        MAIN.beam.scale.set(1, 1, Math.max(0.4, d));
      }
    }

    /* --- charging: rings climb the hull while it sits on the pad --- */
    for(var ci=0; ci<CHARGE_RINGS.length; ci++){
      var CR = CHARGE_RINGS[ci];
      if(!charging){ CR.obj.visible = false; continue; }
      CR.obj.visible = true;
      var f = ((t*0.45 + CR.off) % 1);
      CR.obj.position.set(droid.position.x, f*4.6, droid.position.z);
      CR.obj.scale.setScalar(1.05 - f*0.35);
      CR.mat.opacity = 0.55 * Math.sin(f*Math.PI);
    }

    /* --- footprints: heat where the primary walked ---------------------- */
    if(!reduce && roam.speed > 0.6){
      trailAcc += dt;
      if(trailAcc > 0.8){
        trailAcc = 0;
        // a free slot, else the faintest one — recycling the oldest print
        // avoids cutting a fresh one short and popping visibly
        var tslot = TRAIL[0];
        for(var fi=0; fi<TRAIL.length; fi++){
          if(TRAIL[fi].life <= 0){ tslot = TRAIL[fi]; break; }
          if(TRAIL[fi].life < tslot.life) tslot = TRAIL[fi];
        }
        tslot.life = TRAIL_LIFE;
        tslot.obj.position.set(droid.position.x, 0.03, droid.position.z);
        tslot.obj.scale.setScalar(1.1);
      }
    } else {
      trailAcc = 0;
    }
    for(var fj=0; fj<TRAIL.length; fj++){
      var FT = TRAIL[fj];
      if(FT.life <= 0){ FT.obj.visible = false; continue; }
      FT.life -= dt;
      FT.obj.visible = true;
      FT.mat.opacity = Math.max(0, 0.10 * (FT.life / TRAIL_LIFE));
    }

    /* --- sonar: the session said something to you ---------------------
       The rings leave from the antenna tips, not the floor: this is a
       broadcast outward, and the head snap below turns the dome to face
       you first so the ping reads as aimed, not ambient. */
    if(sonarReq){
      sonarReq = false;
      // voice of the session model, bent by camera distance: far reads lower
      var dop = clamp(1.3 - camera.position.distanceTo(droid.position)*0.02, 0.7, 1.2);
      SOUND.chirp(2, voiceRate(live.model)*dop);
      sonarT0 = t;
      MAIN.antennas.getWorldPosition(tmp);
      sonarX = tmp.x; sonarY = tmp.y; sonarZ = tmp.z;
      turnDome(MAIN, -MAIN.domeTarget);        // it turns to face you as well
    }
    for(var si=0; si<SONAR.length; si++){
      var S = SONAR[si];
      var sp = (t - sonarT0)/SONAR_DUR - S.off;
      if(sp <= 0 || sp >= 1){ S.obj.visible = false; continue; }
      S.obj.visible = true;
      var se = 1 - Math.pow(1-sp, 2.4);         // fast out, long tail
      S.obj.position.set(sonarX, sonarY + se*2.2, sonarZ);
      S.obj.scale.setScalar(0.7 + se*13.5);
      S.mat.opacity = 0.62 * Math.pow(1-sp, 1.6);
    }

    /* --- turn rings: the session's rhythm, laid on the floor ---------- */
    for(var ti2=0; ti2<TURNS.length; ti2++){
      var TR = TURNS[ti2];
      if(TR.life <= 0){ TR.obj.visible = false; continue; }
      TR.life -= dt/48;                         // about a minute of memory
      TR.grow = damp(TR.grow, 1, 2.6, dt);
      TR.obj.scale.setScalar(TR.r * TR.grow);
      TR.mat.opacity = Math.max(0, 0.34 * TR.life * TR.grow);
      TR.obj.visible = TR.mat.opacity > 0.006;
    }

    /* --- queue depth ---------------------------------------------------- */
    for(var qi=0; qi<QSTACK.blocks.length; qi++){
      var QB = QSTACK.blocks[qi];
      QB.lv = damp(QB.lv, qi < live.queue ? 1 : 0, 5, dt);
      QB.mat.opacity = QB.lv * (0.30 + 0.22*(0.5+0.5*Math.sin(t*1.6 - qi*0.5)));
      QB.obj.visible = QB.lv > 0.02;
      QB.obj.scale.setScalar(0.55 + 0.45*QB.lv);
    }

    /* --- supervision: amber perimeter while nothing is being asked ----- */
    SUPER.lit = damp(SUPER.lit, live.perm === "bypassPermissions" ? 1 : 0, 3, dt);
    SUPER.mat.opacity = SUPER.lit * (0.16 + 0.10*(0.5+0.5*Math.sin(t*1.1)));
    SUPER.ring.visible = SUPER.bars.visible = SUPER.lit > 0.02;

    if(workshop.userData.tiles)  workshop.userData.tiles.tick(dt);
    if(workshop.userData.ledger) workshop.userData.ledger.tick(dt);

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
    }
    if(workshop.userData.monitor){
      var busy = Math.min(1, MOD.scp.p + MOD.man.p + MOD.sns.p + MOD.int.p*0.5);
      workshop.userData.monitor.tick(dt, status, busy, live.events, live.errors);
    }

    if(scanOn){
      var span=7.5;
      scanRing.position.y=(t*1.5)%span;
      scanRing.material.opacity=0.42*(1-((t*1.5)%span)/span);
    }
    gridGroup.rotation.y = t*0.018;

    updateTags(size[0],size[1]);
    renderer.render(scene,camera);
  }
  frame();
})();
