//! Ядро Transly. Кожен модуль повторює відповідний файл `app/src/core/*.ts` з тією самою поведінкою;
//! еталон — «золоті вектори» (`tests/vectors/*.json`), які генерує `npm run vectors` у `app/`.

pub mod js;
pub mod merge;
pub mod model;
pub mod variants;
pub mod workflow;
