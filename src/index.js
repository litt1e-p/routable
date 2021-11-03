import Routable from 'core/index.vue';

const components = [Routable]

const install = function (Vue) {
  components.forEach(component => {
    Vue.mixin(component)
  })
}

if (typeof window !== 'undefined' && window.Vue) {
  install(window.Vue);
}

export default install
export { Routable } // if need to install as component
