// Design -> run plan (format fmri-run-plan/1): every onset, every jittered
// duration, every prompt item, every layer resolved to exactly what is drawn.
//
// The browser player (stage.js) and the PsychoPy runner (runner/fmri_runner)
// both play only this, so neither needs to know what a trial type or a
// prompt list is -- and the run they play is the run you see here. The
// server checks the shape (app/models/plans.py) before writing it anywhere.
//
// Everything is drawn from one seeded generator, so a seed gives the same run
// every time, in the browser and in PsychoPy alike. A session compiles as one
// unit so "don't repeat items within a session" holds across its runs.
const Compile = {
  FORMAT: "fmri-run-plan/1",

  // mulberry32: small, fast, and the same sequence in every browser.
  rng( seed ) {
    let a = seed >>> 0;
    return function () {
      a = ( a + 0x6d2b79f5 ) >>> 0;
      let t = a;
      t = Math.imul( t ^ ( t >>> 15 ) , t | 1 );
      t ^= t + Math.imul( t ^ ( t >>> 7 ) , t | 61 );
      return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
    };
  },

  newSeed() {
    const buffer = new Uint32Array( 1 );
    crypto.getRandomValues( buffer );
    return buffer[ 0 ] % 1000000000;
  },

  shuffle( list , rng ) {
    const out = list.slice();
    for ( let i = out.length - 1; i > 0; i -= 1 ) {
      const j = Math.floor( rng() * ( i + 1 ) );
      [ out[ i ] , out[ j ] ] = [ out[ j ] , out[ i ] ];
    }
    return out;
  },

  // -- layers ---------------------------------------------------------------

  // "{column}" placeholders filled from the item. Unknown columns stay as
  // written, so a typo is visible on screen (validate.js flags it too).
  fill( template , item , list ) {
    return String( template ).replace( /\{([a-z_][a-z0-9_]*)\}/g , ( whole , key ) => {
      if ( !item || !list || !list.columns.some( ( c ) => c.key === key ) ) return whole;
      return item.values[ key ] == null ? "" : String( item.values[ key ] );
    } );
  },

  // A layer as drawn: placeholders filled, colours defaulted, pictures by
  // sha. Returns null for a layer that comes out empty (no text, no
  // picture), which is how optional content works.
  resolveLayer( doc , layer , item , list ) {
    const color = layer.color || doc.display.text_color;
    if ( layer.kind === "text" ) {
      const text = this.fill( layer.text , item , list );
      if ( text.trim() === "" ) return null;
      const out = { kind: "text" , text: text , pos: layer.pos.slice() , height: layer.height , color: color , wrap: layer.wrap };
      if ( layer.bold ) out.bold = true;
      return out;
    }
    if ( layer.kind === "image" ) {
      const media = this.fill( layer.media , item , list ).trim();
      const entry = media ? doc.media.find( ( m ) => m.id === media ) : null;
      if ( !entry ) return null;
      if ( layer.fit ) {
        // Full sized: as large as fits on the screen, centred, its shape kept.
        // Written out as a plain height and width, so the players need not
        // know about it.
        const shape = entry.w / entry.h;
        const aspect = doc.display.aspect;
        const height = shape > aspect ? aspect / shape : 1;
        const r = ( x ) => Math.round( x * 10000 ) / 10000;
        return { kind: "image" , media: media , pos: [ 0 , 0 ] , height: r( height ) , width: r( height * shape ) };
      }
      return { kind: "image" , media: media , pos: layer.pos.slice() , height: layer.height };
    }
    const shape = { kind: "shape" , shape: layer.shape , pos: layer.pos.slice() , size: layer.size , color: color , fill: layer.fill , ori: layer.ori , line_width: layer.line_width };
    if ( layer.shape === "polygon" ) shape.sides = layer.sides;
    return shape;
  },

  resolveLayers( doc , layers , item , list ) {
    return layers.map( ( layer ) => this.resolveLayer( doc , layer , item , list ) ).filter( Boolean );
  },

  // -- prompt items -----------------------------------------------------------

  // Whether a trial type draws only part of its list.
  filtered( tt ) {
    return Boolean( tt.filter.column && tt.filter.values.length );
  },

  // The items of its list a trial type may draw: those its filter lets through.
  itemsFor( tt , list ) {
    if ( !list ) return [];
    if ( !this.filtered( tt ) ) return list.items;
    return list.items.filter( ( item ) => tt.filter.values.includes( item.values[ tt.filter.column ] == null ? "" : String( item.values[ tt.filter.column ] ) ) );
  },

  // The item's text and number columns, for the logs: { key: value }, empty
  // values left out.
  itemValues( item , list ) {
    const out = {};
    if ( !item || !list ) return out;
    list.columns.filter( ( c ) => c.type !== "image" ).slice( 0 , 32 ).forEach( ( c ) => {
      const value = item.values[ c.key ] == null ? "" : String( item.values[ c.key ] );
      if ( value !== "" ) out[ c.key ] = value.slice( 0 , 2000 );
    } );
    return out;
  },

  // Hands out items for each trial type's list, honouring filter, order,
  // balance_by and no_repeat. One Picker per compile; `used` is shared across the runs
  // of a session. seenBefore is the set of item ids this participant was
  // shown on earlier visits: preferred against, within whatever balance_by
  // picked, and repeated only when nothing else is left.
  picker( doc , rng , seenBefore ) {
    const used = {};        // list id -> Set of item ids already shown (this session)
    const cursor = {};      // list id (trial type id when filtered) -> next index, for sequential
    const balance = {};     // trial type id -> { value: times picked }
    const warnings = [];
    return {
      warnings: warnings,
      newRun() {
        doc.trial_types.forEach( ( tt ) => {
          if ( tt.no_repeat === "run" && used[ tt.list ] ) used[ tt.list ] = new Set();
        } );
      },
      pick( tt ) {
        const list = doc.lists.find( ( l ) => l.id === tt.list );
        const items = Compile.itemsFor( tt , list );
        if ( items.length === 0 ) return { item: null , list: null };
        const seen = used[ list.id ] || ( used[ list.id ] = new Set() );
        if ( tt.order === "sequential" ) {
          const key = Compile.filtered( tt ) ? tt.id : list.id;
          const index = ( cursor[ key ] || 0 ) % items.length;
          cursor[ key ] = index + 1;
          return { item: items[ index ] , list: list };
        }
        let pool = tt.no_repeat === "none" ? items : items.filter( ( item ) => !seen.has( item.id ) );
        if ( pool.length === 0 ) {
          // Only this trial type's items start over; others sharing the list
          // still avoid what they have shown.
          warnings.push( { kind: "reused" , list: list.name } );
          items.forEach( ( item ) => seen.delete( item.id ) );
          pool = items;
        }
        if ( tt.balance_by && list.columns.some( ( c ) => c.key === tt.balance_by ) ) {
          const tally = balance[ tt.id ] || ( balance[ tt.id ] = {} );
          const groups = {};
          pool.forEach( ( item ) => {
            const value = item.values[ tt.balance_by ] || "";
            ( groups[ value ] || ( groups[ value ] = [] ) ).push( item );
          } );
          const value = Compile.balanceValue( tt , items , Object.keys( groups ) , tally , rng );
          tally[ value ] = ( tally[ value ] || 0 ) + 1;
          pool = groups[ value ];
        }
        if ( seenBefore && tt.no_repeat !== "none" ) {
          const unseen = pool.filter( ( candidate ) => !seenBefore.has( candidate.id ) );
          if ( unseen.length ) pool = unseen;
          else warnings.push( { kind: "seen_before" , list: list.name } );
        }
        const item = pool[ Math.floor( rng() * pool.length ) ];
        seen.add( item.id );
        return { item: item , list: list };
      },
    };
  },

  // The two values of a trial type's balance_by column, first as the list
  // has them, or null when it does not have exactly two.
  balancePair( tt , items ) {
    const values = Array.from( new Set( items.map( ( item ) => item.values[ tt.balance_by ] || "" ) ) );
    return values.length === 2 ? values : null;
  },

  // Which value of balance_by comes next. Evenly, the one picked least so
  // far, ties at random. With two values and a share other than 50%, the
  // first value's running count stays within a trial of that share, and
  // inside that margin the choice is random, so the sequence cannot be
  // learned the way a fixed pattern could.
  balanceValue( tt , items , available , tally , rng ) {
    const pair = tt.balance_pct === 50 || available.length < 2 ? null : this.balancePair( tt , items );
    if ( pair ) {
      const [ first , second ] = pair;
      const have = tally[ first ] || 0;
      const target = ( tt.balance_pct / 100 ) * ( have + ( tally[ second ] || 0 ) + 1 );
      if ( have + 1 <= Math.floor( target ) ) return first;
      if ( have >= Math.ceil( target ) ) return second;
      return rng() < target - Math.floor( target ) ? first : second;
    }
    const fewest = Math.min( ...available.map( ( v ) => tally[ v ] || 0 ) );
    const candidates = available.filter( ( v ) => ( tally[ v ] || 0 ) === fewest );
    return candidates[ Math.floor( rng() * candidates.length ) ];
  },

  itemLabel( item , list ) {
    if ( !item || !list ) return "";
    const column = list.columns.find( ( c ) => c.type === "text" && item.values[ c.key ] ) || null;
    return column ? String( item.values[ column.key ] ).slice( 0 , 200 ) : item.id;
  },

  // The trial types of one block repetition, in the order they are shown.
  blockOrder( block , rng ) {
    const expanded = [];
    block.mix.forEach( ( entry ) => {
      for ( let k = 0; k < entry.count; k += 1 ) expanded.push( entry.trial_type );
    } );
    if ( block.order === "shuffle" ) return this.shuffle( expanded , rng );
    if ( block.order === "alternate" ) {
      // Round-robin through the mix: A B A B ..., then whatever is left.
      const queues = block.mix.map( ( entry ) => Array( entry.count ).fill( entry.trial_type ) );
      const out = [];
      while ( queues.some( ( q ) => q.length ) ) queues.forEach( ( q ) => { if ( q.length ) out.push( q.shift() ); } );
      return out;
    }
    return expanded;
  },

  // -- plans ------------------------------------------------------------------

  header( doc , experiment , run , options ) {
    const scan = Timing.scan( doc , run.tr === undefined ? null : run );
    const header = {
      format: this.FORMAT,
      experiment: { id: experiment.id || "" , name: doc.name.slice( 0 , 200 ) },
      run: { id: run.id , name: ( run.name || "" ).slice( 0 , 200 ) , label: options.label },
      participant: ( options.participant || "" ).slice( 0 , 64 ),
      seed: options.seed,
      created: new Date().toISOString().slice( 0 , 19 ) + "Z",
      scanner: { tr: scan.tr , trigger_key: doc.scanner.trigger_key , dummy_volumes: scan.dummy , wait: options.scanner !== "none" },
      display: { background: doc.display.background , text_color: doc.display.text_color , font: doc.display.font },
      keys: { quit: doc.keys.quit.length ? doc.keys.quit : [ "escape" ] , advance: doc.keys.advance.length ? doc.keys.advance : [ "space" ] },
    };
    // Which saved version of the design this came from, for the run record.
    if ( options.revision > 0 ) header.revision = options.revision;
    return header;
  },

  finish( doc , plan , segments ) {
    const last = segments.filter( ( s ) => s.kind !== "instructions" ).pop();
    const total = last ? this.round( last.onset + last.duration ) : 0;
    const media = {};
    segments.forEach( ( segment ) => segment.layers.forEach( ( layer ) => {
      if ( layer.kind !== "image" ) return;
      const entry = doc.media.find( ( m ) => m.id === layer.media );
      media[ layer.media ] = { ext: entry.ext , w: entry.w , h: entry.h };
    } ) );
    return Object.assign( plan , {
      segments: segments,
      total_seconds: total,
      volumes: plan.scanner.dummy_volumes + Math.ceil( total / plan.scanner.tr - 1e-9 ),
      media: media,
    } );
  },

  round( x ) {
    return Timing.round4( x );
  },

  // One run. picker carries no_repeat across the runs of a session.
  run( doc , experiment , run , options , picker , rng ) {
    const tr = Timing.scan( doc , run ).tr;
    const segments = [];
    // Which trial type and phase (by id) each segment came from, for the HRF
    // graphs (static/js/efficiency.js); browser-only, like warnings.
    const trace = [];
    let t = 0;
    const push = ( segment , from ) => {
      segment.onset = this.round( t );
      segment.duration = this.round( segment.duration );
      segments.push( segment );
      trace[ segments.length - 1 ] = from || null;
      t += segment.duration;
    };
    if ( run.instructions.enabled && options.instructions !== false ) {
      const layers = this.resolveLayers( doc , run.instructions.layers , null , null );
      if ( layers.length ) segments.push( { onset: 0 , duration: 0 , kind: "instructions" , label: I18n.get( "compile.instructions" ) , layers: layers } );
    }
    const leadIn = Timing.leadDraw( run.lead_in , tr , rng );
    if ( leadIn > 0 ) push( { kind: "lead_in" , label: I18n.get( "compile.lead_in" ) , duration: leadIn , layers: this.resolveLayers( doc , run.lead_in.layers ) } );

    const allRepeats = [];
    run.blocks.forEach( ( block ) => {
      for ( let r = 0; r < block.repeat; r += 1 ) allRepeats.push( block );
    } );
    // A pilot plays the first N block repetitions. Drawing is sequential, so
    // those trials are the same ones the whole run would have started with.
    const repeats = options.blocks > 0 ? allRepeats.slice( 0 , options.blocks ) : allRepeats;
    let trialIndex = 0;
    repeats.forEach( ( block , index ) => {
      this.blockOrder( block , rng ).forEach( ( typeId ) => {
        const tt = doc.trial_types.find( ( x ) => x.id === typeId );
        if ( !tt ) return;
        const picked = picker.pick( tt );
        const label = this.itemLabel( picked.item , picked.list );
        tt.phases.forEach( ( phase ) => {
          const segment = {
            kind: "phase" , label: phase.name || "" , duration: Timing.sample( phase.duration , tr , rng ),
            trial: trialIndex , block: index , trial_type: tt.name || "" , phase: phase.name || "" ,
            layers: this.resolveLayers( doc , phase.layers , picked.item , picked.list ),
          };
          if ( picked.item ) {
            segment.item = picked.item.id;
            segment.item_label = label;
            segment.item_values = this.itemValues( picked.item , picked.list );
          }
          if ( phase.response.keys.length ) segment.response = { keys: phase.response.keys.slice() , ends_phase: phase.response.ends_phase };
          push( segment , { trial_type: tt.id , phase: phase.id } );
        } );
        trialIndex += 1;
      } );
      if ( index < repeats.length - 1 && block.rest_after.seconds > 0 ) {
        push( { kind: "rest" , block: index , label: block.name || I18n.get( "compile.rest" ) , duration: block.rest_after.seconds , layers: this.resolveLayers( doc , block.rest_after.layers ) } );
      }
    } );
    const leadOut = Timing.leadDraw( run.lead_out , tr , rng );
    if ( leadOut > 0 ) push( { kind: "lead_out" , label: I18n.get( "compile.lead_out" ) , duration: leadOut , layers: this.resolveLayers( doc , run.lead_out.layers ) } );
    const plan = this.finish( doc , this.header( doc , experiment , run , options ) , segments );
    plan.trace = segments.map( ( segment , index ) => trace[ index ] || null );
    if ( repeats.length < allRepeats.length ) plan.pilot_blocks = repeats.length;
    return plan;
  },

  label( text ) {
    return String( text ).replace( /[^A-Za-z0-9_.-]+/g , "-" ).replace( /^-+|-+$/g , "" ).slice( 0 , 64 ) || "run";
  },

  // A run on its own: [plan].
  runPlans( doc , experiment , runId , options ) {
    const run = doc.runs.find( ( r ) => r.id === runId );
    const rng = this.rng( options.seed );
    const picker = this.picker( doc , rng , options.seen );
    const index = doc.runs.indexOf( run ) + 1;
    const plan = this.run( doc , experiment , run , Object.assign( {} , options , { label: "run-" + String( index ).padStart( 2 , "0" ) } ) , picker , rng );
    plan.warnings = picker.warnings;
    return [ plan ];
  },

  // Every run step of a session, in order, drawn together: [plan, ...].
  sessionPlans( doc , experiment , sessionId , options ) {
    const session = doc.sessions.find( ( s ) => s.id === sessionId );
    const rng = this.rng( options.seed );
    const picker = this.picker( doc , rng , options.seen );
    // The visit is the ses- label: this participant's nth time in the
    // scanner. Without one, the session's place in the design.
    const visit = options.visit > 0 ? options.visit : doc.sessions.indexOf( session ) + 1;
    const sessionNumber = String( visit ).padStart( 2 , "0" );
    const plans = [];
    Timing.items( doc , session ).forEach( ( entry ) => {
      // A break belongs to the run before it: both players show it on the
      // screen between that run and the next.
      if ( entry.kind === "break" && plans.length ) {
        const before = plans[ plans.length - 1 ];
        before.break_after = this.round( ( before.break_after || 0 ) + entry.seconds.mean );
      }
      const run = entry.kind === "run" ? entry.run : null;
      if ( !run ) return;
      picker.newRun();
      const label = "ses-" + sessionNumber + "_run-" + String( plans.length + 1 ).padStart( 2 , "0" );
      const plan = this.run( doc , experiment , run , Object.assign( {} , options , { label: label } ) , picker , rng );
      plan.session = { id: session.id , name: ( session.name || "" ).slice( 0 , 200 ) };
      plan.visit = visit;
      plans.push( plan );
    } );
    // A break after the last run has no next run to wait for.
    if ( plans.length ) delete plans[ plans.length - 1 ].break_after;
    plans.forEach( ( plan ) => { plan.warnings = picker.warnings; } );
    return plans;
  },

  // One trial of one trial type, with a chosen item (or a random one): a
  // short plan with no scanner wait, for seeing how a trial looks.
  trialPlans( doc , experiment , trialTypeId , itemId , options ) {
    const tt = doc.trial_types.find( ( x ) => x.id === trialTypeId );
    const rng = this.rng( options.seed );
    const list = doc.lists.find( ( l ) => l.id === tt.list ) || null;
    const items = this.itemsFor( tt , list );
    let item = items.find( ( i ) => i.id === itemId ) || null;
    if ( !item && items.length ) item = items[ Math.floor( rng() * items.length ) ];
    const pseudoRun = { id: tt.id , name: tt.name };
    const segments = [];
    let t = 0;
    tt.phases.forEach( ( phase ) => {
      const segment = {
        onset: this.round( t ) , duration: Timing.sample( phase.duration , doc.scanner.tr , rng ),
        kind: "phase" , label: phase.name || "" , trial: 0 , trial_type: tt.name || "" , phase: phase.name || "",
        layers: this.resolveLayers( doc , phase.layers , item , list ),
      };
      if ( item ) {
        segment.item = item.id;
        segment.item_label = this.itemLabel( item , list );
        segment.item_values = this.itemValues( item , list );
      }
      if ( phase.response.keys.length ) segment.response = { keys: phase.response.keys.slice() , ends_phase: phase.response.ends_phase };
      segments.push( segment );
      t += segment.duration;
    } );
    const header = this.header( doc , experiment , pseudoRun , Object.assign( {} , options , { label: "trial-" + this.label( tt.name ) , scanner: "none" } ) );
    return [ this.finish( doc , header , segments ) ];
  },

  // What the server accepts: the plan without browser-only extras.
  forServer( plans ) {
    return plans.map( ( plan ) => {
      const copy = Object.assign( {} , plan );
      delete copy.warnings;
      delete copy.trace;
      return copy;
    } );
  },
};
