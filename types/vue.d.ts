/**
 * Extends interfaces in Vue.js
 */

<<<<<<< HEAD
import { ComponentCustomOptions, ComponentCustomProperties } from "vue";
=======
import { ComponentCustomOptions } from "vue";
>>>>>>> upstream/4.0
import { Store } from "./index";

declare module "@vue/runtime-core" {
  interface ComponentCustomOptions {
    store?: Store<any>;
  }
}
