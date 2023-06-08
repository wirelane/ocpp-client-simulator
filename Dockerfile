FROM node:alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN apk --no-cache add --virtual native-deps g++ gcc libgcc libstdc++ linux-headers make python3
RUN npm install node-gyp -g
RUN npm install
RUN apk del native-deps

# RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY index.js .

CMD [ "npm", "start" ]