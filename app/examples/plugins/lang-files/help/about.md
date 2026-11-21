A `.lang` file has one line per string: `key=value`. Lines that start with `#` or `;` are comments.

- Open the folder that holds the `.lang` files: every file becomes a file of the project.
- A line break inside a value is written `\n`; Transly shows it as a real line break while you translate.
- The build writes the translation back to the same lines; everything you did not translate stays as it was.
