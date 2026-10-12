/** Serializable, non-destructive recipe. Source identities and output resources
 * stay separate; future editors must commit outputs through host transactions. */
export interface ImageTransformRecipe {
  version: 1;
  quarterTurns: 0 | 1 | 2 | 3;
  flipHorizontal: boolean;
  flipVertical: boolean;
}
export type ImageTransformOperation =
  | "rotate-right"
  | "rotate-left"
  | "flip-horizontal"
  | "flip-vertical"
  | "reset";
export const DEFAULT_IMAGE_RECIPE: Readonly<ImageTransformRecipe> =
  Object.freeze({
    version: 1,
    quarterTurns: 0,
    flipHorizontal: false,
    flipVertical: false,
  });
export function applyImageTransform(
  recipe: ImageTransformRecipe,
  operation: ImageTransformOperation,
): ImageTransformRecipe {
  if (operation === "reset") return { ...DEFAULT_IMAGE_RECIPE };
  if (operation === "flip-horizontal")
    return { ...recipe, flipHorizontal: !recipe.flipHorizontal };
  if (operation === "flip-vertical")
    return { ...recipe, flipVertical: !recipe.flipVertical };
  return {
    ...recipe,
    quarterTurns: ((recipe.quarterTurns +
      (operation === "rotate-right" ? 1 : 3)) %
      4) as ImageTransformRecipe["quarterTurns"],
  };
}
/** Fit the rotated extent without upscaling tiny images. */
export function imageFitScale(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  quarterTurns: number,
): number {
  if (
    ![width, height, viewportWidth, viewportHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return 1;
  const sideways = quarterTurns % 2 !== 0;
  return Math.min(
    1,
    viewportWidth / (sideways ? height : width),
    viewportHeight / (sideways ? width : height),
  );
}
export function imageRecipeCss(recipe: ImageTransformRecipe): string {
  return `rotate(${recipe.quarterTurns * 90}deg) scale(${recipe.flipHorizontal ? -1 : 1},${recipe.flipVertical ? -1 : 1})`;
}
