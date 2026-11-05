// Everything about a design that would play wrong, said out loud.
//
// The old planner's trouble was pieces silently drifting apart. Here every
// reference is an id, and this file lists each one that points at nothing,
// each {column} that names no column, each list too short for what draws
// from it -- shown as a count on the navbar badge and as a list on Overview,
// each line linking to where it is fixed.
//
// check(doc) -> [{ level: "error" | "warning", screen, id, text }]
const Validate = {
  check( doc ) {
    const problems = [];
    const say = ( level , screen , id , key , vars ) => {
      let text = I18n.get( "problems." + key );
      Object.entries( vars || {} ).forEach( ( [ name , value ] ) => { text = text.split( "{" + name + "}" ).join( String( value ) ); } );
      problems.push( { level: level , screen: screen , id: id , text: text } );
    };
    const named = ( thing , fallbackKey ) => thing.name || I18n.get( fallbackKey );
    const mediaIds = new Set( doc.media.map( ( m ) => m.id ) );

    const checkLayers = ( layers , list , screen , id , where ) => {
      const keys = list ? list.columns.map( ( c ) => c.key ) : [];
      layers.forEach( ( layer ) => {
        const template = layer.kind === "text" ? layer.text : layer.kind === "image" ? layer.media : "";
        ( template.match( /\{([a-z_][a-z0-9_]*)\}/g ) || [] ).forEach( ( token ) => {
          const key = token.slice( 1 , -1 );
          if ( !list ) say( "error" , screen , id , "template_no_list" , { where: where , token: token } );
          else if ( !keys.includes( key ) ) say( "error" , screen , id , "template_no_column" , { where: where , token: token , list: named( list , "lists.unnamed" ) } );
          else if ( layer.kind === "image" && list.columns.find( ( c ) => c.key === key ).type !== "image" ) {
            say( "warning" , screen , id , "template_not_image" , { where: where , token: token } );
          }
        } );
        if ( layer.kind === "image" && layer.media && !layer.media.includes( "{" ) && !mediaIds.has( layer.media ) ) {
          say( "error" , screen , id , "missing_picture" , { where: where } );
        }
      } );
    };

    if ( !doc.trial_types.length ) say( "warning" , "trials" , null , "no_trial_types" );
    if ( !doc.runs.length ) say( "warning" , "runs" , null , "no_runs" );
    if ( !doc.sessions.length ) say( "warning" , "sessions" , null , "no_sessions" );

    doc.lists.forEach( ( list ) => {
      const name = named( list , "lists.unnamed" );
      if ( !list.items.length ) say( "warning" , "prompts" , list.id , "list_empty" , { list: name } );
      list.columns.filter( ( c ) => c.type === "image" ).forEach( ( column ) => {
        const missing = list.items.filter( ( item ) => item.values[ column.key ] && !mediaIds.has( item.values[ column.key ] ) ).length;
        if ( missing ) say( "error" , "prompts" , list.id , "list_missing_pictures" , { list: name , column: column.label || column.key , count: missing } );
      } );
    } );

    doc.trial_types.forEach( ( tt ) => {
      const name = named( tt , "trials.unnamed" );
      const list = tt.list ? doc.lists.find( ( l ) => l.id === tt.list ) || null : null;
      if ( tt.list && !list ) say( "error" , "trials" , tt.id , "trial_list_gone" , { trial: name } );
      if ( list && tt.balance_by && !list.columns.some( ( c ) => c.key === tt.balance_by ) ) {
        say( "error" , "trials" , tt.id , "trial_balance_gone" , { trial: name , column: tt.balance_by } );
      }
      if ( list && tt.filter.column && !list.columns.some( ( c ) => c.key === tt.filter.column ) ) {
        say( "error" , "trials" , tt.id , "trial_filter_gone" , { trial: name , column: tt.filter.column } );
      } else if ( list && list.items.length && Compile.filtered( tt ) && !Compile.itemsFor( tt , list ).length ) {
        say( "warning" , "trials" , tt.id , "trial_filter_empty" , { trial: name , list: named( list , "lists.unnamed" ) } );
      }
      if ( !tt.phases.length ) say( "error" , "trials" , tt.id , "trial_no_phases" , { trial: name } );
      tt.phases.forEach( ( phase , index ) => {
        const where = name + " › " + ( phase.name || I18n.get( "trials.phase" ) + " " + ( index + 1 ) );
        checkLayers( phase.layers , list , "trials" , tt.id , where );
        const d = phase.duration;
        if ( d.kind === "geometric" && Timing.geometric( d , doc.scanner.tr ).degenerate ) {
          say( "warning" , "trials" , tt.id , "geometric_too_short" , { where: where , tr: doc.scanner.tr } );
        }
        if ( d.kind !== "fixed" && d.max <= d.min ) say( "warning" , "trials" , tt.id , "jitter_no_range" , { where: where } );
        if ( Timing.span( d , doc.scanner.tr ).max === 0 ) say( "warning" , "trials" , tt.id , "phase_zero" , { where: where } );
      } );
    } );

    doc.runs.forEach( ( run ) => {
      const name = named( run , "runs.unnamed" );
      checkLayers( run.instructions.layers , null , "runs" , run.id , name + " › " + I18n.get( "runs.instructions" ) );
      checkLayers( run.lead_in.layers , null , "runs" , run.id , name + " › " + I18n.get( "runs.lead_in" ) );
      checkLayers( run.lead_out.layers , null , "runs" , run.id , name + " › " + I18n.get( "runs.lead_out" ) );
      let trials = 0;
      run.blocks.forEach( ( block ) => {
        checkLayers( block.rest_after.layers , null , "runs" , run.id , name + " › " + I18n.get( "runs.rest" ) );
        block.mix.forEach( ( entry ) => {
          if ( !doc.trial_types.some( ( tt ) => tt.id === entry.trial_type ) ) say( "error" , "runs" , run.id , "run_trial_gone" , { run: name } );
          trials += entry.count * block.repeat;
        } );
      } );
      if ( trials === 0 ) say( "warning" , "runs" , run.id , "run_empty" , { run: name } );
    } );

    // Modelled phases the run cannot tell apart (on its first draw, as the
    // Runs screen shows by default).
    if ( Efficiency.regressors( doc ).length ) {
      doc.runs.forEach( ( run ) => {
        let result = null;
        try {
          result = Efficiency.run( doc , run , 1 );
        } catch ( error ) {
          return;
        }
        if ( result.maxCorrelation != null && ( result.maxCorrelation > 0.8 || result.maxVif > 5 ) ) {
          say( "warning" , "runs" , run.id , "run_collinear" , { run: named( run , "runs.unnamed" ) , r: result.maxCorrelation.toFixed( 2 ) , vif: Number.isFinite( result.maxVif ) ? result.maxVif.toFixed( 1 ) : "∞" } );
        }
      } );
    }

    doc.sessions.forEach( ( session ) => {
      const name = named( session , "sessions.unnamed" );
      Timing.activeSteps( session ).forEach( ( step ) => {
        if ( step.kind === "run" && !doc.runs.some( ( r ) => r.id === step.run ) ) say( "error" , "sessions" , session.id , "session_run_gone" , { session: name } );
      } );
      // Lists drawn from without repeats within a session: enough items? A
      // list is checked against the items its trial types can draw between
      // them, and a filtered trial type against what its filter lets through.
      const need = {};
      const drawable = {};
      const ownNeed = {};
      Timing.activeSteps( session ).filter( ( s ) => s.kind === "run" ).forEach( ( step ) => {
        const run = doc.runs.find( ( r ) => r.id === step.run );
        if ( !run ) return;
        const counts = Timing.run( doc , run ).counts;
        Object.keys( counts ).forEach( ( ttId ) => {
          const tt = doc.trial_types.find( ( x ) => x.id === ttId );
          if ( !tt || !tt.list || tt.order !== "shuffle" ) return;
          const scope = tt.no_repeat === "session" ? "s" : tt.no_repeat === "run" ? run.id + step.id : null;
          if ( !scope ) return;
          const key = tt.list + "|" + scope;
          need[ key ] = ( need[ key ] || 0 ) + counts[ ttId ];
          const list = doc.lists.find( ( l ) => l.id === tt.list );
          const ids = drawable[ key ] || ( drawable[ key ] = new Set() );
          Compile.itemsFor( tt , list ).forEach( ( item ) => ids.add( item.id ) );
          if ( Compile.filtered( tt ) ) {
            const own = ttId + "|" + scope;
            ownNeed[ own ] = ( ownNeed[ own ] || 0 ) + counts[ ttId ];
          }
        } );
      } );
      Object.keys( need ).forEach( ( key ) => {
        const list = doc.lists.find( ( l ) => l.id === key.split( "|" )[ 0 ] );
        const have = drawable[ key ] ? drawable[ key ].size : 0;
        if ( list && have && need[ key ] > have ) {
          say( "warning" , "prompts" , list.id , "list_too_short" , { list: named( list , "lists.unnamed" ) , session: name , need: need[ key ] , have: have } );
        }
      } );
      Object.keys( ownNeed ).forEach( ( key ) => {
        const tt = doc.trial_types.find( ( x ) => x.id === key.split( "|" )[ 0 ] );
        const have = Compile.itemsFor( tt , doc.lists.find( ( l ) => l.id === tt.list ) ).length;
        if ( have && ownNeed[ key ] > have ) {
          say( "warning" , "trials" , tt.id , "trial_too_short" , { trial: named( tt , "trials.unnamed" ) , session: name , need: ownNeed[ key ] , have: have } );
        }
      } );
    } );

    // The limits you set yourself. The longest a run or session could come
    // out, since one that sometimes overruns still overruns.
    const limits = doc.limits;
    const minutes = ( seconds ) => Math.round( seconds / 6 ) / 10;
    if ( limits.max_run_minutes > 0 ) {
      doc.runs.forEach( ( run ) => {
        const longest = Timing.run( doc , run ).total.max;
        if ( longest / 60 > limits.max_run_minutes + 1e-9 ) say( "warning" , "runs" , run.id , "limit_run" , { run: named( run , "runs.unnamed" ) , minutes: minutes( longest ) , limit: limits.max_run_minutes } );
      } );
    }
    doc.sessions.forEach( ( session ) => {
      const info = Timing.session( doc , session );
      const name = named( session , "sessions.unnamed" );
      if ( limits.max_session_minutes > 0 && info.seconds.max / 60 > limits.max_session_minutes + 1e-9 ) {
        say( "warning" , "sessions" , session.id , "limit_session" , { session: name , minutes: minutes( info.seconds.max ) , limit: limits.max_session_minutes } );
      }
      if ( limits.max_runs_per_session > 0 && info.runs > limits.max_runs_per_session ) {
        say( "warning" , "sessions" , session.id , "limit_runs" , { session: name , runs: info.runs , limit: limits.max_runs_per_session } );
      }
    } );

    // The runner reads the trigger key as a pulse first and refuses to start
    // on such a design, so say so here, long before the scanner.
    const trigger = String( doc.scanner.trigger_key );
    const triggerNames = /^\d+$/.test( trigger ) ? [ trigger , "num_" + trigger ] : [ trigger ];
    doc.trial_types.forEach( ( tt ) => tt.phases.forEach( ( phase ) => {
      const clash = phase.response.keys.find( ( key ) => triggerNames.includes( key ) );
      if ( clash ) say( "error" , "trials" , tt.id , "response_is_trigger" , { trial: named( tt , "trials.unnamed" ) , key: clash } );
    } ) );

    const budget = Timing.budget( doc );
    if ( budget.available > 0 && budget.used > budget.available + 1e-9 ) {
      say( "warning" , "overview" , null , "over_budget" , { used: Timing.hours( budget.used ) , available: Timing.hours( budget.available ) } );
    }
    return problems;
  },

  // Where something is used, for "can't delete, still used by ...".
  usages( doc , kind , id ) {
    const found = [];
    if ( kind === "list" ) {
      doc.trial_types.filter( ( tt ) => tt.list === id ).forEach( ( tt ) => found.push( tt.name || I18n.get( "trials.unnamed" ) ) );
    } else if ( kind === "trial_type" ) {
      doc.runs.filter( ( run ) => run.blocks.some( ( b ) => b.mix.some( ( m ) => m.trial_type === id ) ) ).forEach( ( run ) => found.push( run.name || I18n.get( "runs.unnamed" ) ) );
    } else if ( kind === "run" ) {
      doc.sessions.filter( ( s ) => s.steps.some( ( step ) => step.kind === "run" && step.run === id ) ).forEach( ( s ) => found.push( s.name || I18n.get( "sessions.unnamed" ) ) );
    } else if ( kind === "scanner" ) {
      doc.runs.filter( ( run ) => run.card && run.card.id === id ).forEach( ( run ) => found.push( run.name || I18n.get( "runs.unnamed" ) ) );
      doc.sessions.filter( ( s ) => s.steps.some( ( step ) => step.kind === "scan" && step.card && step.card.id === id ) ).forEach( ( s ) => found.push( s.name || I18n.get( "sessions.unnamed" ) ) );
    } else if ( kind === "media" ) {
      doc.lists.forEach( ( list ) => {
        const n = list.items.filter( ( item ) => Object.values( item.values ).includes( id ) ).length;
        if ( n ) found.push( ( list.name || I18n.get( "lists.unnamed" ) ) + " (" + n + ")" );
      } );
      const inLayers = ( layers ) => layers.some( ( l ) => l.kind === "image" && l.media === id );
      doc.trial_types.forEach( ( tt ) => { if ( tt.phases.some( ( p ) => inLayers( p.layers ) ) ) found.push( tt.name || I18n.get( "trials.unnamed" ) ); } );
      doc.runs.forEach( ( run ) => {
        const screens = [ run.instructions , run.lead_in , run.lead_out ].concat( run.blocks.map( ( b ) => b.rest_after ) );
        if ( screens.some( ( s ) => inLayers( s.layers ) ) ) found.push( run.name || I18n.get( "runs.unnamed" ) );
      } );
    }
    return found;
  },
};
