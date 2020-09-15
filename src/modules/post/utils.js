const collapseImages = (body) => {
  const galleryPrototype = {
    type: "gallery",
    content: [],
  };
  const imageTag = "sweet_image_preview";
  const extractedImages = [];
  if (body && body.content.length) {
    /**
     * Walk the array. If we find a sweet_image_preview:
     *
     * If gallery index is null, we start a new gallery.
     *
     * 1. Create a gallery node _before_ sweet_image_preview,
     *    save the index of the gallery node
     * 2. Place the sweet_image_preview inside the gallery node
     *
     * If our gallery index is > 0, this continues the gallery.
     *
     * 1. Add the image to the gallery node at the index
     *    saved above
     */
    let galleryIndex = null;
    let skipNode = false;
    let imagesInGallery = 0;
    body.content.forEach((node, index, array) => {
      // If we've just created a gallery, we need to skip
      // the next element in our array walk because it's
      // the same image (creating the gallery has shifted
      // all the indexes forward by 1)
      if (skipNode === true) {
        skipNode = false;
        return;
      }
      if (node.type === imageTag) {
        console.log("It's an image!");
        const { thumbnail, ...extractedAttrs } = node.attrs;
        const image = {
          type: "image",
          attrs: extractedAttrs,
        };
        // While we're parsing images, push the image into an object
        // so we can process images below.
        extractedImages.push(extractedAttrs);
        // We can have up to four images in a gallery
        // There are 4 or fewer images, so add a new one to the
        // current gallery
        if (imagesInGallery < 4) {
          console.log("Fewer than 4 images.");
          if (galleryIndex === null) {
            console.log("We're not in a gallery");
            // Clone the gallery prototype into the object
            array.splice(index, 0, JSON.parse(JSON.stringify(galleryPrototype)));
            // Set the index to where the gallery is
            galleryIndex = index;
            // Set the next node to be skipped (it's the same image)
            skipNode = true;
            // Reset the number of images in the gallery
            imagesInGallery = 0;
          }
          // Add this image to the gallery
          array[galleryIndex].content.push(image);
          // Start counting images in the gallery
          imagesInGallery = imagesInGallery + 1;
          console.log("Adding an image to the gallery!", image.attrs.src);
          console.log(`It's image ${imagesInGallery} in this gallery.`);
          console.log(`The gallery is at index ${galleryIndex}.`);
        } else {
          console.log("More than 4 images.");
          // There are now more than four images, so we need to
          // restart a gallery
          // Clone the gallery prototype into the object
          console.log("Creating new gallery");
          array.splice(index, 0, JSON.parse(JSON.stringify(galleryPrototype)));
          // Set the index to where the gallery is
          galleryIndex = index;
          // Set the next node to be skipped (it's the same image)
          skipNode = true;
          // Reset the number of images in the gallery
          imagesInGallery = 0;
          // Add this image to the gallery
          array[galleryIndex].content.push(image);
          // Start counting images in the gallery
          imagesInGallery = imagesInGallery + 1;
          console.log("[2] Adding an image to the gallery!", image.attrs.src);
          console.log(`[2] It's image ${imagesInGallery} in this gallery.`);
          console.log(`[2] The gallery is at index ${galleryIndex}.`);
        }
      } else {
        console.log("It's no longer an image!");
        // Reset the gallery index and the number of images in the
        // gallery, so we can start a new gallery
        galleryIndex = null;
        imagesInGallery = 0;
      }
    });
    body.content = body.content.filter((node) => node.type !== imageTag);
  }
  return { parsedBody: body, extractedImages };
};

const findMentions = (body) => {
  const mentions = [];
  const recursiveNodeWalk = (node) => {
    if (node && node.content) {
      node.content.forEach((child) => {
        if (child.type === 'mention') {
          if (!mentions.includes(child.attrs.id)) {
            mentions.push(child.attrs.id);
          }
        }
        recursiveNodeWalk(child);
      });
    }
  };
  if (body && body.content && body.content.length) {
    recursiveNodeWalk(body);
  }
  return mentions;
};

module.exports = {
  collapseImages,
  findMentions,
};