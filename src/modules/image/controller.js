const aws = require('aws-sdk')
const sharp = require('sharp')
const formidable = require('formidable')
const { nanoid } = require('nanoid')
const { sendResponse, sendError } = require('../../utils');
const { maxImageSize, imageQuality } = require('../../config/constants')

const s3 = new aws.S3({
  accessKeyId: process.env.S3_ACCESS_KEY,
  secretAccessKey: process.env.S3_SECRET
})

const uploadImage = async (buffer, imageKey) => {
  if (!buffer || !imageKey) {
    console.log('uploadImage expects 2 parameters!')
    return false
  }
  const uploadParams = {
    Body: buffer,
    Bucket: 'sweet-images',
    Key: imageKey,
    ACL: 'public-read',
  }
  const uploadPromise = s3.putObject(uploadParams).promise()
  return uploadPromise.then((data) => {
    console.log(`Image ${uploadParams.Key} uploaded to S3 bucket ${uploadParams.Bucket}`)
    return data
  }).catch((err) => {
    console.log(`Error uploading image ${uploadParams.Key} to S3 bucket ${uploadParams.Bucket}`)
    console.log(err)
    return false
  })
}

const processImage = async ({ file, prefix, imageQualitySettings }) => {
  if (!file) {
    return { status: 400, error: 'No file data was received' }
  }
  let sharpImage
  let imageMeta
  let finalFormat
  // Use sharp to harvest some image metadata - this is our first test to see if the received file is valid
  try {
    sharpImage = sharp(file.path)
    imageMeta = await sharpImage.metadata()
  } catch (err) {
    return { status: 500, error: 'File failed to be loaded by sharp for format determination: ' + err }
  }
  const imageFormat = imageMeta.format
  // Check that the file type is an image
  if (!['jpeg', 'jpg', 'png', 'gif'].includes(imageFormat)) {
    return { status: 400, error: 'Received file is not an image' }
  }
  // Check that the file is not too large
  if ((imageFormat === 'gif' && file.size > maxImageSize.gif) || (['jpeg', 'jpg', 'png'].includes(imageFormat) && file.size > maxImageSize.jpg)) {
    return { status: 400, error: 'Received image file is too large (maximum 10MB for jpg/png and 5MB for gif)' }
  }
  let imageKey = `${prefix}/${nanoid()}`
  if (imageFormat === 'gif') {
    // No processing happens to GIFs - if they're under 5MB in size, they're simply uploaded
    finalFormat = 'gif'
  } else if (['jpeg', 'jpg', 'png'].includes(imageFormat)) {
    sharpImage = sharpImage.resize({
      width: imageQualitySettings.resize,
      withoutEnlargement: true
    }).rotate()
    if (imageFormat === 'png' && imageQualitySettings.name === 'standard') {
      // Prevent PNG transparency - fill it with white
      sharpImage = sharpImage.flatten({ background: { r: 255, g: 255, b: 255 } })
    }
    if (imageFormat === 'jpeg' || imageQualitySettings.name === 'standard') {
      sharpImage = sharpImage.jpeg({ quality: imageQualitySettings.jpegQuality })
      finalFormat = 'jpg'
    } else {
      sharpImage = sharpImage.png()
      finalFormat = 'png'
    }
  } else {
    // This should never happen because it implies that the image file's format has changed halfway through the function
    return { status: 500, error: 'Unexpected failure processing image file' }
  }

  // Generate the image buffer
  const imageBuffer = await sharpImage.toBuffer()
  // Upload to S3
  imageKey = `${imageKey}.${finalFormat}`
  const uploadResponse = await uploadImage(imageBuffer, imageKey)
  if (uploadResponse) {
    // The image has been uploaded successfully!
    let thumbnail = sharp(file.path).resize({ height: 60, withoutEnlargement: true }).rotate().jpeg()
    thumbnail = await thumbnail.toBuffer()
    const responsePayload = {
      imageKey: imageKey,
      thumbnail: `data:image/${finalFormat};base64,${thumbnail.toString('base64')}`
    }
    return { status: 200, payload: responsePayload }
  } else {
    // Error during upload
    return { status: 500, error: 'Error uploading to S3 bucket' }
  }
}

const createImage = async (req, res) => {
  const form = formidable({ multiples: true })
  form.parse(req, async (err, fields, files) => {
    if (err) {
      next(err)
      return
    }
    const imageQualitySettings = imageQuality[req.user.settings.imageQuality]
    const imageResponse = await processImage({ file: files.image, prefix: 'images', imageQualitySettings })
    return res.status(imageResponse.status).send(imageResponse.error ? sendError(imageResponse.status, imageResponse.error) : sendResponse(imageResponse.payload, imageResponse.status))
  })

  // if (req.body.image) {
  //   req.body.images.forEach(async (filename) => {
  //     const image = new Image({
  //       context: isCommunityPost ? 'community' : 'user',
  //       filename: `images/${filename}`,
  //       url: `https://sweet-images.s3.eu-west-2.amazonaws.com/images/${filename}`,
  //       privacy: isPrivate ? 'private' : 'public',
  //       user: req.user._id,
  //       // DEBUG: NOT YET ENABLED
  //       // quality: postImageQuality,
  //       // height: metadata.height,
  //       // width: metadata.width
  //     })
  //     await image.save()
  //   })
  // }
}

module.exports = {
  createImage
}