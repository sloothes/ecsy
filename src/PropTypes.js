export const copyValue = (src, dest, key) => (dest[key] = src[key]);

export const cloneValue = src => src;

export const copyArray = (src, dest, key) => {
  const srcArray = src[key];
  const destArray = dest[key];

  destArray.length = 0;

  for (let i = 0; i < srcArray.length; i++) {
    destArray.push(srcArray[i]);
  }

  return destArray;
};

export const cloneArray = src => src.slice();

export const copyJSON = (src, dest, key) =>
  (dest[key] = JSON.parse(JSON.stringify(src[key])));

export const cloneJSON = src => JSON.parse(JSON.stringify(src));

export const copyCopyable = (src, dest, key) => dest[key].copy(src[key]);

export const cloneClonable = src => src.clone();

export const createType = (name, defaultValue, clone, copy) => ({
  name,
  default: defaultValue,
  clone,
  copy
});

// TODO: Add names
export const PropTypes = {
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
