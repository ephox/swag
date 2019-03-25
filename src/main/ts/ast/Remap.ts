import * as estree from 'estree';
import { readImports, toAst, createImport, ImportInfo, ImportInfoKind } from './Imports';
import { resolveSync } from '../fs/Resolve';
import { FileSystem } from '../fs/FileSystem';
import { readMainModule } from '../ast/MainModule';
import { parse } from '../ast/Parser';
import { fail } from '../utils/Fail';
import { RemapCache } from './RemapCache';

const isImport = (node: estree.Node) => node.type === 'ImportDeclaration';
const isWrapModuleImport = (path: string) => /^@ephox\/wrap\-[^\/]*/.test(path);
const isGlobalsModuleImport = (path: string) => /^@ephox\/[^\-]+\-globals$/.test(path);
const isEphoxModuleImport = (path: string) => /^@ephox\/[^\/]*$/.test(path);
const isRemapTargetImport = (path: string) => isEphoxModuleImport(path) && !isGlobalsModuleImport(path) && !isWrapModuleImport(path);

const findRootName = (modulePath: string) => {
  const parts = modulePath.split('/');
  const idx = parts.lastIndexOf('node_modules');
  return idx !== -1 ? parts.slice(0, idx).join('/') : '/';
};

const remapImport = (fs: FileSystem, remapCache: RemapCache, id: string, imp: ImportInfo, forceFlat: boolean): ImportInfo => {
  const mainModulePath = remapCache.mainModuleResolveCache.getOrThunk(
    findRootName(id) + '-' + imp.modulePath,
    () => resolveSync(fs, imp.modulePath, id, forceFlat)
  );

  const mainModule = remapCache.mainModuleCache.getOrThunk(mainModulePath, () => {
    const mainModuleProgram = parse(fs.readFileSync(mainModulePath).toString());
    return readMainModule(mainModuleProgram);
  });

  const exportForImport = mainModule.exports.find((exp) => exp.name === imp.fromName);
  if (!exportForImport) {
    fail(`Could not find export ${imp.fromName} in main module ${mainModulePath}`);
  }

  const mainImportFromExport = mainModule.imports.find((mi) => mi.name === exportForImport.fromName);
  if (!exportForImport) {
    fail(`Could not find import ${exportForImport.fromName} in main module ${mainModulePath}`);
  }

  const resolvedModulePath = remapCache.moduleResolveCache.getOrThunk(
    mainImportFromExport.modulePath + '-' + mainModulePath,
    () => resolveSync(fs, mainImportFromExport.modulePath, mainModulePath, forceFlat)
  );

  return createImport(mainImportFromExport.kind, imp.name, mainImportFromExport.fromName, resolvedModulePath);
};

const remapImports = (fs: FileSystem, remapCache: RemapCache, id: string, imports: ImportInfo[], forceFlat: boolean): ImportInfo[] => {
  return imports.map((imp) => {
    return isRemapTargetImport(imp.modulePath) && imp.kind !== ImportInfoKind.SideEffect ? remapImport(fs, remapCache, id, imp, forceFlat) : imp;
  });
};

const remap = (fs: FileSystem, remapCache: RemapCache, id: string, node: estree.Program, forceFlat: boolean): void => {
  const imports = readImports(node);
  const body = node.body.filter((n) => !isImport(n));
  const remappedImports = remapImports(fs, remapCache, id, imports, forceFlat);
  node.body = [].concat(toAst(remappedImports)).concat(body);
};

export {
  remap
};