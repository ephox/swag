import { Plugin } from 'rollup';
import rollupDts, { Options} from 'rollup-plugin-dts';
import * as ts from 'typescript';
import { clean, CleanerOptions } from '../ast/ts/DtsCleaner';
import { parse } from '../ast/ts/Parser';
import { fail } from '../utils/Fail';

interface DtsOptions extends CleanerOptions, Options {
  clean?: boolean;
  validate?: boolean;
}

const formatHost: ts.FormatDiagnosticsHost = {
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getNewLine: () => ts.sys.newLine,
  getCanonicalFileName: ts.sys.useCaseSensitiveFileNames ? (f) => f : (f) => f.toLowerCase(),
};

const validate = (filename: string, code: string) => {
  // Parse and get the diagnostics
  const program = parse(code, filename);
  const diagnostics = program.getDeclarationDiagnostics()
    .concat(program.getSyntacticDiagnostics())
    .concat(program.getSemanticDiagnostics());

  // Check if anything failed and if so log an error
  if (diagnostics.length > 0) {
    // tslint:disable-next-line:no-console
    console.error(ts.formatDiagnostics(diagnostics, formatHost));
    fail('Failed to compile');
  }
};

const cleanCode = (filename: string, code: string, options: CleanerOptions) => {
  const source = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true);
  return clean(source, options);
};

const dts = (options: DtsOptions = {}): Plugin => {
  const dtsPlugin = rollupDts(options);

  return {
    name: 'swag-dts',
    ...dtsPlugin,
    outputOptions(outputOptions) {
      // Need to override the entry filename, as the plugin converts it to "name.d.d.ts"
      return dtsPlugin.outputOptions.call(dtsPlugin, {
        ...outputOptions,
        entryFileNames: outputOptions.entryFileNames || '[name].ts'
      });
    },
    renderChunk(code, chunk) {
      const output = dtsPlugin.renderChunk.call(dtsPlugin, code, chunk);
      // Strip out source mapping comments
      const transformedCode = output.code.replace(/\/\/# sourceMappingURL=\w+\.d\.ts\.map/g, '');
      if (process.env.SWAG_DTS_DEBUG) {
        // tslint:disable-next-line:no-console
        console.debug('Transformed:\n' + transformedCode);
      }

      // Parse the source and clean
      const cleanedCode = options.clean === false ? transformedCode : cleanCode(chunk.fileName, transformedCode, options);
      if (process.env.SWAG_DTS_DEBUG) {
        // tslint:disable-next-line:no-console
        console.debug('Cleaned:\n' + transformedCode);
      }

      // Validate if required
      if (options.validate !== false) {
        validate(chunk.fileName, cleanedCode);
      }
      return {
        ...output,
        code: cleanedCode
      };
    }
  };
};

export {
  DtsOptions,
  dts
};
