//! Ядро Transly. Кожен модуль повторює відповідний файл `app/src/core/*.ts` з тією самою поведінкою;
//! еталон — «золоті вектори» (`tests/vectors/*.json`), які генерує `npm run vectors` у `app/`.

pub mod glossary;
pub mod journal;
pub mod js;
pub mod merge;
pub mod model;
pub mod variants;
pub mod plan;
pub mod plural;
pub mod strands;
pub mod termmatch;
pub mod termusage;
pub mod ukmorph;
pub mod workflow;
