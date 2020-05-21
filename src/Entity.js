import Query from "./Query.js";
import { wrapImmutableComponent } from "./WrapImmutableComponent.js";

// @todo Take this out from there or use ENV
const DEBUG = false;

export class Entity {
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

    return DEBUG ? wrapImmutableComponent(Component, component) : component;
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
