class SystemManager {
  constructor(world) {
    this._systems = [];
    this._executeSystems = []; // Systems that have `execute` method
    this.world = world;
    this.lastExecutedSystem = null;
  }

  registerSystem(System, attributes) {
    if (
      this._systems.find(s => s.constructor.name === System.name) !== undefined
    ) {
      console.warn(`System '${System.name}' already registered.`);
      return this;
    }

    var system = new System(this.world, attributes);
    if (system.init) system.init();
    system.order = this._systems.length;
    this._systems.push(system);
    if (system.execute) {
      this._executeSystems.push(system);
      this.sortSystems();
    }
    return this;
  }

  sortSystems() {
    this._executeSystems.sort((a, b) => {
      return a.priority - b.priority || a.order - b.order;
    });
  }

  getSystem(System) {
    return this._systems.find(s => s instanceof System);
  }

  getSystems() {
    return this._systems;
  }

  removeSystem(System) {
    var index = this._systems.indexOf(System);
    if (!~index) return;

    this._systems.splice(index, 1);
  }

  executeSystem(system, delta, time) {
    if (system.initialized) {
      if (system.canExecute()) {
        let startTime = performance.now();
        system.execute(delta, time);
        system.executeTime = performance.now() - startTime;
        this.lastExecutedSystem = system;
        system.clearEvents();
      }
    }
  }

  stop() {
    this._executeSystems.forEach(system => system.stop());
  }

  execute(delta, time, forcePlay) {
    this._executeSystems.forEach(
      system =>
        (forcePlay || system.enabled) && this.executeSystem(system, delta, time)
    );
  }

  stats() {
    var stats = {
      numSystems: this._systems.length,
      systems: {}
    };

    for (var i = 0; i < this._systems.length; i++) {
      var system = this._systems[i];
      var systemStats = (stats.systems[system.constructor.name] = {
        queries: {}
      });
      for (var name in system.ctx) {
        systemStats.queries[name] = system.ctx[name].stats();
      }
    }

    return stats;
  }
}

const Version = "0.2.2";

/**
 * @private
 * @class EventDispatcher
 */
class EventDispatcher {
  constructor() {
    this._listeners = {};
    this.stats = {
      fired: 0,
      handled: 0
    };
  }

  /**
   * Add an event listener
   * @param {String} eventName Name of the event to listen
   * @param {Function} listener Callback to trigger when the event is fired
   */
  addEventListener(eventName, listener) {
    let listeners = this._listeners;
    if (listeners[eventName] === undefined) {
      listeners[eventName] = [];
    }

    if (listeners[eventName].indexOf(listener) === -1) {
      listeners[eventName].push(listener);
    }
  }

  /**
   * Check if an event listener is already added to the list of listeners
   * @param {String} eventName Name of the event to check
   * @param {Function} listener Callback for the specified event
   */
  hasEventListener(eventName, listener) {
    return (
      this._listeners[eventName] !== undefined &&
      this._listeners[eventName].indexOf(listener) !== -1
    );
  }

  /**
   * Remove an event listener
   * @param {String} eventName Name of the event to remove
   * @param {Function} listener Callback for the specified event
   */
  removeEventListener(eventName, listener) {
    var listenerArray = this._listeners[eventName];
    if (listenerArray !== undefined) {
      var index = listenerArray.indexOf(listener);
      if (index !== -1) {
        listenerArray.splice(index, 1);
      }
    }
  }

  /**
   * Dispatch an event
   * @param {String} eventName Name of the event to dispatch
   * @param {Entity} entity (Optional) Entity to emit
   * @param {Component} component
   */
  dispatchEvent(eventName, entity, component) {
    this.stats.fired++;

    var listenerArray = this._listeners[eventName];
    if (listenerArray !== undefined) {
      var array = listenerArray.slice(0);

      for (var i = 0; i < array.length; i++) {
        array[i].call(this, entity, component);
      }
    }
  }

  /**
   * Reset stats counters
   */
  resetCounters() {
    this.stats.fired = this.stats.handled = 0;
  }
}

/**
 * Get a key from a list of components
 * @param {Array(Component)} Components Array of components to generate the key
 * @private
 */
function queryKey(Components) {
  var names = [];
  for (var n = 0; n < Components.length; n++) {
    var T = Components[n];
    if (typeof T === "object") {
      var operator = T.operator === "not" ? "!" : T.operator;
      names.push(operator + T.Component.name);
    } else {
      names.push(T.name);
    }
  }

  return names.sort().join("-");
}

class Query {
  /**
   * @param {Array(Component)} Components List of types of components to query
   */
  constructor(Components, world) {
    this.Components = [];
    this.NotComponents = [];

    Components.forEach(component => {
      if (typeof component === "object") {
        this.NotComponents.push(component.Component);
      } else {
        this.Components.push(component);
      }
    });

    if (this.Components.length === 0) {
      throw new Error("Can't create a query without components");
    }

    this.entities = [];

    this.eventDispatcher = new EventDispatcher();

    // This query is being used by a reactive system
    this.reactive = false;

    this.key = queryKey(Components);

    // Fill the query with the existing entities
    for (var i = 0; i < world.entities.length; i++) {
      var entity = world.entities[i];
      if (this.match(entity)) {
        // @todo ??? this.addEntity(entity); => preventing the event to be generated
        entity.queries.push(this);
        this.entities.push(entity);
      }
    }
  }

  /**
   * Add entity to this query
   * @param {Entity} entity
   */
  addEntity(entity) {
    entity.queries.push(this);
    this.entities.push(entity);

    this.eventDispatcher.dispatchEvent(Query.prototype.ENTITY_ADDED, entity);
  }

  /**
   * Remove entity from this query
   * @param {Entity} entity
   */
  removeEntity(entity) {
    let index = this.entities.indexOf(entity);
    if (~index) {
      this.entities.splice(index, 1);

      index = entity.queries.indexOf(this);
      entity.queries.splice(index, 1);

      this.eventDispatcher.dispatchEvent(
        Query.prototype.ENTITY_REMOVED,
        entity
      );
    }
  }

  match(entity) {
    return (
      entity.hasAllComponents(this.Components) &&
      !entity.hasAnyComponents(this.NotComponents)
    );
  }

  toJSON() {
    return {
      key: this.key,
      reactive: this.reactive,
      components: {
        included: this.Components.map(C => C.name),
        not: this.NotComponents.map(C => C.name)
      },
      numEntities: this.entities.length
    };
  }

  /**
   * Return stats for this query
   */
  stats() {
    return {
      numComponents: this.Components.length,
      numEntities: this.entities.length
    };
  }
}

Query.prototype.ENTITY_ADDED = "Query#ENTITY_ADDED";
Query.prototype.ENTITY_REMOVED = "Query#ENTITY_REMOVED";
Query.prototype.COMPONENT_CHANGED = "Query#COMPONENT_CHANGED";

const proxyMap = new WeakMap();

const proxyHandler = {
  set(target, prop) {
    throw new Error(
      `Tried to write to "${target.constructor.name}#${String(
        prop
      )}" on immutable component. Use .getMutableComponent() to modify a component.`
    );
  }
};

function wrapImmutableComponent(T, component) {
  if (component === undefined) {
    return undefined;
  }

  let wrappedComponent = proxyMap.get(component);

  if (!wrappedComponent) {
    wrappedComponent = new Proxy(component, proxyHandler);
    proxyMap.set(component, wrappedComponent);
  }

  return wrappedComponent;
}

class Entity {
  constructor(world) {
    this.world = world;

    // Unique ID for this entity
    this._id = this.world.nextEntityId++;

    // List of components types the entity has
    this.componentTypes = [];

    // Instance of the components
    this.components = {};

    this._componentsToRemove = {};

    // Queries where the entity is added
    this.queries = [];

    // Used for deferred removal
    this._componentTypesToRemove = [];

    this._alive = false;

    this._numSystemStateComponents = 0;
  }

  get alive() {
    return this._alive;
  }

  // COMPONENTS

  getComponent(Component, includeRemoved) {
    var component = this.components[Component.name];

    if (!component && includeRemoved === true) {
      component = this._componentsToRemove[Component.name];
    }

    return  component;
  }

  getRemovedComponent(Component) {
    return this._componentsToRemove[Component.name];
  }

  getComponents() {
    return this.components;
  }

  getComponentsToRemove() {
    return this._componentsToRemove;
  }

  getComponentTypes() {
    return this.componentTypes;
  }

  getMutableComponent(Component) {
    var component = this.components[Component.name];

    if (this._alive) {
      for (var i = 0; i < this.queries.length; i++) {
        var query = this.queries[i];
        // @todo accelerate this check. Maybe having query._Components as an object
        if (query.reactive && query.Components.indexOf(Component) !== -1) {
          query.eventDispatcher.dispatchEvent(
            Query.prototype.COMPONENT_CHANGED,
            this,
            component
          );
        }
      }
    }

    return component;
  }

  attachComponent(component) {
    const Component = component.constructor;

    if (~this.componentTypes.indexOf(Component)) return;

    this.componentTypes.push(Component);

    if (Component.isSystemStateComponent) {
      this._numSystemStateComponents++;
    }

    this.components[Component.name] = component;

    if (this._alive) {
      this.world.onComponentAdded(this, Component);
    }

    return this;
  }

  addComponent(Component, props) {
    if (~this.componentTypes.indexOf(Component)) return;

    this.componentTypes.push(Component);

    if (Component.isSystemStateComponent) {
      this._numSystemStateComponents++;
    }

    var componentPool = this.world.getComponentPool(Component);

    var component =
      componentPool === undefined
        ? new Component(props)
        : componentPool.acquire();

    if (componentPool && props) {
      component.copy(props);
    }

    this.components[Component.name] = component;

    if (this._alive) {
      this.world.onComponentAdded(this, Component);
    }

    return this;
  }

  hasComponent(Component, includeRemoved) {
    return (
      !!~this.componentTypes.indexOf(Component) ||
      (includeRemoved === true && this.hasRemovedComponent(Component))
    );
  }

  hasRemovedComponent(Component) {
    return !!~this._componentTypesToRemove.indexOf(Component);
  }

  hasAllComponents(Components) {
    for (var i = 0; i < Components.length; i++) {
      if (!this.hasComponent(Components[i])) return false;
    }
    return true;
  }

  hasAnyComponents(Components) {
    for (var i = 0; i < Components.length; i++) {
      if (this.hasComponent(Components[i])) return true;
    }
    return false;
  }

  removeComponent(Component, immediately) {
    const componentName = Component.name;
    const component = this.components[componentName];

    if (!this._componentsToRemove[componentName]) {
      delete this.components[componentName];

      const index = this.componentTypes.indexOf(Component);
      this.componentTypes.splice(index, 1);

      if (this._alive) {
        this.world.onRemoveComponent(this, Component);
      }
    }

    if (immediately) {
      if (component) {
        component.dispose();
      }

      if (this._componentsToRemove[componentName]) {
        delete this._componentsToRemove[componentName];
        const index = this._componentTypesToRemove.indexOf(Component);

        if (index !== -1) {
          this._componentTypesToRemove.splice(index, 1);
        }
      }
    } else if (this._alive) {
      this._componentTypesToRemove.push(Component);
      this._componentsToRemove[componentName] = component;
      this.world.queueComponentRemoval(this, Component);
    }

    if (Component.isSystemStateComponent) {
      this._numSystemStateComponents--;

      // Check if the entity was a ghost waiting for the last system state component to be removed
      if (this._numSystemStateComponents === 0 && !this._alive) {
        this.dispose();
      }
    }

    return true;
  }

  processRemovedComponents() {
    while (this._componentTypesToRemove.length > 0) {
      let Component = this._componentTypesToRemove.pop();
      this.removeComponent(Component, true);
    }
  }

  // TODO: Optimize this
  removeAllComponents(immediately) {
    let Components = this.componentTypes;

    for (let j = Components.length - 1; j >= 0; j--) {
      this.removeComponent(Components[j], immediately);
    }
  }

  copy(source) {
    // DISCUSS: Should we reset ComponentTypes and components here or in dispose?
    for (const componentName in source.components) {
      const sourceComponent = source.components[componentName];
      this.components[componentName] = sourceComponent.clone();
      this.componentTypes.push(sourceComponent.constructor);
    }

    return this;
  }

  clone() {
    return new this.constructor(this.world).copy(this);
  }

  dispose(immediately) {
    if (this._alive) {
      this.removeAllComponents(immediately);
      this.queries.length = 0;
    }

    this._alive = false;

    if (immediately) {
      this._id = this.world.nextEntityId++;

      this.world.onEntityDisposed(this);

      if (this._pool) {
        this._pool.release(this);
      }
    } else {
      this.world.queueEntityDisposal(this);
    }
  }
}

class ObjectPool {
  constructor(baseObject, initialSize) {
    this.freeList = [];
    this.count = 0;
    this.baseObject = baseObject;
    this.isObjectPool = true;

    if (typeof initialSize !== "undefined") {
      this.expand(initialSize);
    }
  }

  acquire() {
    // Grow the list by 20%ish if we're out
    if (this.freeList.length <= 0) {
      this.expand(Math.round(this.count * 0.2) + 1);
    }

    var item = this.freeList.pop();

    return item;
  }

  release(item) {
    item.copy(this.baseObject);
    this.freeList.push(item);
  }

  expand(count) {
    for (var n = 0; n < count; n++) {
      const clone = this.baseObject.clone();
      clone._pool = this;
      this.freeList.push(clone);
    }
    this.count += count;
  }

  totalSize() {
    return this.count;
  }

  totalFree() {
    return this.freeList.length;
  }

  totalUsed() {
    return this.count - this.freeList.length;
  }
}

class World {
  constructor() {
    this.systemManager = new SystemManager(this);

    this.entityPool = new ObjectPool(new Entity(this));

    this.entities = [];
    this.entitiesById = {};
    this.nextEntityId = 0;

    this.entitiesWithComponentsToRemove = [];
    this.entitiesToRemove = [];
    this.deferredRemovalEnabled = true;

    this.componentTypes = {};
    this.componentPools = {};
    this.componentCounts = {};

    this.queries = {};

    this.enabled = true;

    if (typeof CustomEvent !== "undefined") {
      var event = new CustomEvent("ecsy-world-created", {
        detail: { world: this, version: Version }
      });
      window.dispatchEvent(event);
    }

    this.lastTime = performance.now();

    this.isWorld = true;
  }

  registerComponent(Component, objectPool) {
    if (this.componentTypes[Component.name]) {
      console.warn(`Component type: '${Component.name}' already registered.`);
      return this;
    }

    const schema = Component.schema;

    if (!schema) {
      throw new Error(`Component "${Component.name}" has no schema property.`);
    }

    for (const propName in schema) {
      const prop = schema[propName];

      if (!prop.type) {
        throw new Error(
          `Invalid schema for component "${Component.name}". Missing type for "${propName}" property.`
        );
      }

      if (!prop.type.name) {
        console.warn(
          `Schema for component "${Component.name}" has property "${propName}" which uses a type with no name.`
        );
      }

      if (!prop.type.hasOwnProperty("default")) {
        throw new Error(
          `Invalid schema for component "${Component.name}". "${propName}" uses type "${prop.type.name}" with no default value.`
        );
      }

      if (!prop.type.clone) {
        throw new Error(
          `Invalid schema for component "${Component.name}". "${propName}" uses type "${prop.type.name}" with no clone method.`
        );
      }

      if (!prop.type.copy) {
        throw new Error(
          `Invalid schema for component "${Component.name}". "${propName}" uses type "${prop.type.name}" with no copy method.`
        );
      }
    }

    this.componentTypes[Component.name] = Component;
    this.componentCounts[Component.name] = 0;

    if (objectPool === false) {
      objectPool = undefined;
    } else if (objectPool === undefined) {
      objectPool = new ObjectPool(new Component());
    }

    this.componentPools[Component.name] = objectPool;

    return this;
  }

  registerSystem(System, attributes) {
    this.systemManager.registerSystem(System, attributes);
    return this;
  }

  createEntity() {
    const entity = this.createDetachedEntity();
    return this.addEntity(entity);
  }

  createDetachedEntity() {
    return this.entityPool.acquire();
  }

  addEntity(entity) {
    if (this.entitiesById[entity._id]) {
      console.warn(`Entity ${entity._id} already added.`);
      return entity;
    }

    this.entitiesById[entity._id] = entity;
    this.entities.push(entity);
    entity._alive = true;

    for (let i = 0; i < entity.componentTypes.length; i++) {
      const Component = entity.componentTypes[i];
      this.onComponentAdded(entity, Component);
    }

    return entity;
  }

  findEntityByName(name) {
    return this.entities.find(e => e.name === name);
  }

  getEntitiesByName(name) {
    return this.entities.filter(e => e.name === name);
  }

  createComponent(Component) {
    const componentPool = this.componentPools[Component.name];

    if (componentPool) {
      return componentPool.acquire();
    }

    return new Component();
  }

  getComponentPool(Component) {
    return this.componentPools[Component.name];
  }

  getSystem(SystemClass) {
    return this.systemManager.getSystem(SystemClass);
  }

  getSystems() {
    return this.systemManager.getSystems();
  }

  getQuery(Components) {
    const key = queryKey(Components);
    let query = this.queries[key];

    if (!query) {
      this.queries[key] = query = new Query(Components, this);
    }

    return query;
  }

  onComponentAdded(entity, Component) {
    if (!this.componentTypes[Component.name]) {
      console.warn(`Component ${Component.name} not registered.`);
    }

    this.componentCounts[Component.name]++;

    // Check each indexed query to see if we need to add this entity to the list
    for (var queryName in this.queries) {
      var query = this.queries[queryName];

      if (
        !!~query.NotComponents.indexOf(Component) &&
        ~query.entities.indexOf(entity)
      ) {
        query.removeEntity(entity);
        continue;
      }

      // Add the entity only if:
      // Component is in the query
      // and Entity has ALL the components of the query
      // and Entity is not already in the query
      if (
        !~query.Components.indexOf(Component) ||
        !query.match(entity) ||
        ~query.entities.indexOf(entity)
      )
        continue;

      query.addEntity(entity);
    }
  }

  onComponentChanged(entity, Component, component) {
    for (var i = 0; i < entity.queries.length; i++) {
      var query = entity.queries[i];
      // @todo accelerate this check. Maybe having query._Components as an object
      if (query.reactive && query.Components.indexOf(Component) !== -1) {
        query.eventDispatcher.dispatchEvent(
          Query.prototype.COMPONENT_CHANGED,
          entity,
          component
        );
      }
    }
  }

  queueComponentRemoval(entity) {
    const index = this.entitiesWithComponentsToRemove.indexOf(entity);

    if (index === -1) {
      this.entitiesWithComponentsToRemove.push(entity);
    }
  }

  onRemoveComponent(entity, Component) {
    this.componentCounts[Component.name]--;

    for (var queryName in this.queries) {
      var query = this.queries[queryName];

      if (
        !!~query.NotComponents.indexOf(Component) &&
        !~query.entities.indexOf(entity) &&
        query.match(entity)
      ) {
        query.addEntity(entity);
        continue;
      }

      if (
        !!~query.Components.indexOf(Component) &&
        !!~query.entities.indexOf(entity) &&
        !query.match(entity)
      ) {
        query.removeEntity(entity);
        continue;
      }
    }
  }

  queueEntityDisposal(entity) {
    this.entitiesToRemove.push(entity);
  }

  onEntityDisposed(entity) {
    if (!this.entitiesById[entity._id]) {
      return;
    }

    delete this.entitiesById[entity._id];

    const index = this.entities.indexOf(entity);

    if (index !== -1) {
      this.entities.splice(index, 1);
    }
  }

  processDeferredRemoval() {
    if (!this.deferredRemovalEnabled) {
      return;
    }

    for (let i = 0; i < this.entitiesToRemove.length; i++) {
      let entity = this.entitiesToRemove[i];
      entity.dispose(true);
    }

    this.entitiesToRemove.length = 0;

    for (let i = 0; i < this.entitiesWithComponentsToRemove.length; i++) {
      let entity = this.entitiesWithComponentsToRemove[i];
      entity.processRemovedComponents();
    }

    this.entitiesWithComponentsToRemove.length = 0;
  }

  execute(delta, time) {
    if (!delta) {
      let time = performance.now();
      delta = time - this.lastTime;
      this.lastTime = time;
    }

    if (this.enabled) {
      this.systemManager.execute(delta, time);
      this.processDeferredRemoval();
    }
  }

  stop() {
    this.enabled = false;
  }

  play() {
    this.enabled = true;
  }

  stats() {
    var stats = {
      entities: {
        numEntities: this.entities.length,
        numQueries: Object.keys(this.queries).length,
        queries: {},
        numComponentPool: Object.keys(this.componentPools).length,
        componentPool: {}
      },
      system: this.systemManager.stats()
    };

    for (const queryName in this.queries) {
      stats.queries[queryName] = this.queries[queryName].stats();
    }

    for (const componentName in this.componentPools) {
      const pool = this.componentPools[componentName];

      stats.componentPool[componentName] = {
        used: pool.totalUsed(),
        size: pool.count
      };
    }

    console.log(JSON.stringify(stats, null, 2));
  }
}

class System {
  // TODO: displayName?

  canExecute() {
    if (this._mandatoryQueries.length === 0) return true;

    for (let i = 0; i < this._mandatoryQueries.length; i++) {
      var query = this._mandatoryQueries[i];
      if (query.entities.length === 0) {
        return false;
      }
    }

    return true;
  }

  constructor(world, attributes) {
    this.world = world;
    this.enabled = true;

    // @todo Better naming :)
    this._queries = {};
    this.queries = {};

    this.priority = 0;

    // Used for stats
    this.executeTime = 0;

    if (attributes && attributes.priority) {
      this.priority = attributes.priority;
    }

    this._mandatoryQueries = [];

    this.initialized = true;

    if (this.constructor.queries) {
      for (var queryName in this.constructor.queries) {
        var queryConfig = this.constructor.queries[queryName];
        var Components = queryConfig.components;
        if (!Components || Components.length === 0) {
          throw new Error("'components' attribute can't be empty in a query");
        }
        var query = this.world.getQuery(Components);
        this._queries[queryName] = query;
        if (queryConfig.mandatory === true) {
          this._mandatoryQueries.push(query);
        }
        this.queries[queryName] = {
          results: query.entities
        };

        // Reactive configuration added/removed/changed
        var validEvents = ["added", "removed", "changed"];

        const eventMapping = {
          added: Query.prototype.ENTITY_ADDED,
          removed: Query.prototype.ENTITY_REMOVED,
          changed: Query.prototype.COMPONENT_CHANGED // Query.prototype.ENTITY_CHANGED
        };

        if (queryConfig.listen) {
          validEvents.forEach(eventName => {
            // Is the event enabled on this system's query?
            if (queryConfig.listen[eventName]) {
              let event = queryConfig.listen[eventName];

              if (eventName === "changed") {
                query.reactive = true;
                if (event === true) {
                  // Any change on the entity from the components in the query
                  let eventList = (this.queries[queryName][eventName] = []);
                  query.eventDispatcher.addEventListener(
                    Query.prototype.COMPONENT_CHANGED,
                    entity => {
                      // Avoid duplicates
                      if (eventList.indexOf(entity) === -1) {
                        eventList.push(entity);
                      }
                    }
                  );
                } else if (Array.isArray(event)) {
                  let eventList = (this.queries[queryName][eventName] = []);
                  query.eventDispatcher.addEventListener(
                    Query.prototype.COMPONENT_CHANGED,
                    (entity, changedComponent) => {
                      // Avoid duplicates
                      if (
                        event.indexOf(changedComponent.constructor) !== -1 &&
                        eventList.indexOf(entity) === -1
                      ) {
                        eventList.push(entity);
                      }
                    }
                  );
                }
              } else {
                let eventList = (this.queries[queryName][eventName] = []);

                query.eventDispatcher.addEventListener(
                  eventMapping[eventName],
                  entity => {
                    // @fixme overhead?
                    if (eventList.indexOf(entity) === -1)
                      eventList.push(entity);
                  }
                );
              }
            }
          });
        }
      }
    }
  }

  stop() {
    this.executeTime = 0;
    this.enabled = false;
  }

  play() {
    this.enabled = true;
  }

  // @question rename to clear queues?
  clearEvents() {
    for (let queryName in this.queries) {
      var query = this.queries[queryName];
      if (query.added) {
        query.added.length = 0;
      }
      if (query.removed) {
        query.removed.length = 0;
      }
      if (query.changed) {
        if (Array.isArray(query.changed)) {
          query.changed.length = 0;
        } else {
          for (let name in query.changed) {
            query.changed[name].length = 0;
          }
        }
      }
    }
  }

  toJSON() {
    var json = {
      name: this.constructor.name,
      enabled: this.enabled,
      executeTime: this.executeTime,
      priority: this.priority,
      queries: {}
    };

    if (this.constructor.queries) {
      var queries = this.constructor.queries;
      for (let queryName in queries) {
        let query = this.queries[queryName];
        let queryDefinition = queries[queryName];
        let jsonQuery = (json.queries[queryName] = {
          key: this._queries[queryName].key
        });

        jsonQuery.mandatory = queryDefinition.mandatory === true;
        jsonQuery.reactive =
          queryDefinition.listen &&
          (queryDefinition.listen.added === true ||
            queryDefinition.listen.removed === true ||
            queryDefinition.listen.changed === true ||
            Array.isArray(queryDefinition.listen.changed));

        if (jsonQuery.reactive) {
          jsonQuery.listen = {};

          const methods = ["added", "removed", "changed"];
          methods.forEach(method => {
            if (query[method]) {
              jsonQuery.listen[method] = {
                entities: query[method].length
              };
            }
          });
        }
      }
    }

    return json;
  }
}

function Not(Component) {
  return {
    operator: "not",
    Component: Component
  };
}

// TODO: The default clone and copy can be made faster by
// generating clone/copy functions at Component registration time
class Component {
  // TODO: displayName?
  constructor(props) {
    const schema = this.constructor.schema;

    for (const key in schema) {
      const schemaProp = schema[key];

      if (props && props.hasOwnProperty(key)) {
        this[key] = props[key];
      } else if (schemaProp.hasOwnProperty("default")) {
        this[key] = schemaProp.type.clone(schemaProp.default);
      } else {
        const type = schemaProp.type;
        this[key] = type.clone(type.default);
      }
    }

    this._pool = null;
  }

  copy(source) {
    const schema = this.constructor.schema;

    for (const key in source) {
      if (schema.hasOwnProperty(key)) {
        const prop = schema[key];
        prop.type.copy(source, this, key);
      }
    }

    return this;
  }

  clone() {
    return new this.constructor().copy(this);
  }

  dispose() {
    if (this._pool) {
      this._pool.release(this);
    }
  }
}

Component.schema = {};
Component.isComponent = true;

class SystemStateComponent extends Component {
  constructor(props) {
    super(props);
    this.isSystemStateComponent = true;
  }
}

SystemStateComponent.isSystemStateComponent = true;

class TagComponent extends Component {
  constructor() {
    super();
    this.isTagComponent = true;
  }
}

TagComponent.isTagComponent = true;

const copyValue = (src, dest, key) => (dest[key] = src[key]);

const cloneValue = src => src;

const copyArray = (src, dest, key) => {
  const srcArray = src[key];
  const destArray = dest[key];

  destArray.length = 0;

  for (let i = 0; i < srcArray.length; i++) {
    destArray.push(srcArray[i]);
  }

  return destArray;
};

const cloneArray = src => src.slice();

const copyJSON = (src, dest, key) =>
  (dest[key] = JSON.parse(JSON.stringify(src[key])));

const cloneJSON = src => JSON.parse(JSON.stringify(src));

const copyCopyable = (src, dest, key) => dest[key].copy(src[key]);

const cloneClonable = src => src.clone();

const createType = (name, defaultValue, clone, copy) => ({
  name,
  default: defaultValue,
  clone,
  copy
});

// TODO: Add names
const PropTypes = {
  Number: { name: "Number", default: 0, clone: cloneValue, copy: copyValue },
  Boolean: {
    name: "Boolean",
    default: false,
    clone: cloneValue,
    copy: copyValue
  },
  String: { name: "String", default: "", clone: cloneValue, copy: copyValue },
  Object: {
    name: "Object",
    default: undefined,
    clone: cloneValue,
    copy: copyValue
  },
  Array: { name: "Array", default: [], clone: cloneArray, copy: copyArray },
  JSON: { name: "JSON", default: null, clone: cloneJSON, copy: copyJSON },
};

function generateId(length) {
  var result = "";
  var characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

function injectScript(src, onLoad) {
  var script = document.createElement("script");
  // @todo Use link to the ecsy-devtools repo?
  script.src = src;
  script.onload = onLoad;
  (document.head || document.documentElement).appendChild(script);
}

/* global Peer */

function hookConsoleAndErrors(connection) {
  var wrapFunctions = ["error", "warning", "log"];
  wrapFunctions.forEach(key => {
    if (typeof console[key] === "function") {
      var fn = console[key].bind(console);
      console[key] = (...args) => {
        connection.send({
          method: "console",
          type: key,
          args: JSON.stringify(args)
        });
        return fn.apply(null, args);
      };
    }
  });

  window.addEventListener("error", error => {
    connection.send({
      method: "error",
      error: JSON.stringify({
        message: error.error.message,
        stack: error.error.stack
      })
    });
  });
}

function includeRemoteIdHTML(remoteId) {
  let infoDiv = document.createElement("div");
  infoDiv.style.cssText = `
    align-items: center;
    background-color: #333;
    color: #aaa;
    display:flex;
    font-family: Arial;
    font-size: 1.1em;
    height: 40px;
    justify-content: center;
    left: 0;
    opacity: 0.9;
    position: absolute;
    right: 0;
    text-align: center;
    top: 0;
  `;

  infoDiv.innerHTML = `Open ECSY devtools to connect to this page using the code:&nbsp;<b style="color: #fff">${remoteId}</b>&nbsp;<button onClick="generateNewCode()">Generate new code</button>`;
  document.body.appendChild(infoDiv);

  return infoDiv;
}

function enableRemoteDevtools(remoteId) {
  window.generateNewCode = () => {
    window.localStorage.clear();
    remoteId = generateId(6);
    window.localStorage.setItem("ecsyRemoteId", remoteId);
    window.location.reload(false);
  };

  remoteId = remoteId || window.localStorage.getItem("ecsyRemoteId");
  if (!remoteId) {
    remoteId = generateId(6);
    window.localStorage.setItem("ecsyRemoteId", remoteId);
  }

  let infoDiv = includeRemoteIdHTML(remoteId);

  window.__ECSY_REMOTE_DEVTOOLS_INJECTED = true;
  window.__ECSY_REMOTE_DEVTOOLS = {};

  let Version = "";

  // This is used to collect the worlds created before the communication is being established
  let worldsBeforeLoading = [];
  let onWorldCreated = e => {
    var world = e.detail.world;
    Version = e.detail.version;
    worldsBeforeLoading.push(world);
  };
  window.addEventListener("ecsy-world-created", onWorldCreated);

  let onLoaded = () => {
    var peer = new Peer(remoteId);
    peer.on("open", (/* id */) => {
      peer.on("connection", connection => {
        window.__ECSY_REMOTE_DEVTOOLS.connection = connection;
        connection.on("open", function() {
          // infoDiv.style.visibility = "hidden";
          infoDiv.innerHTML = "Connected";

          // Receive messages
          connection.on("data", function(data) {
            if (data.type === "init") {
              var script = document.createElement("script");
              script.setAttribute("type", "text/javascript");
              script.onload = () => {
                script.parentNode.removeChild(script);

                // Once the script is injected we don't need to listen
                window.removeEventListener(
                  "ecsy-world-created",
                  onWorldCreated
                );
                worldsBeforeLoading.forEach(world => {
                  var event = new CustomEvent("ecsy-world-created", {
                    detail: { world: world, version: Version }
                  });
                  window.dispatchEvent(event);
                });
              };
              script.innerHTML = data.script;
              (document.head || document.documentElement).appendChild(script);
              script.onload();

              hookConsoleAndErrors(connection);
            } else if (data.type === "executeScript") {
              let value = eval(data.script);
              if (data.returnEval) {
                connection.send({
                  method: "evalReturn",
                  value: value
                });
              }
            }
          });
        });
      });
    });
  };

  // Inject PeerJS script
  injectScript(
    "https://cdn.jsdelivr.net/npm/peerjs@0.3.20/dist/peer.min.js",
    onLoaded
  );
}

const urlParams = new URLSearchParams(window.location.search);

// @todo Provide a way to disable it if needed
if (urlParams.has("enable-remote-devtools")) {
  enableRemoteDevtools();
}

export { Component, Not, ObjectPool, PropTypes, System, SystemStateComponent, TagComponent, Version, World, wrapImmutableComponent as _wrapImmutableComponent, cloneArray, cloneClonable, cloneJSON, cloneValue, copyArray, copyCopyable, copyJSON, copyValue, createType, enableRemoteDevtools };
