import { assert } from '@ember/debug';
import HTTPRequest, { HTTPRequestResponse } from './http-request';
import RSVP from 'rsvp';
import { buildWaiter } from '@ember/test-waiters';
import UploadFile, { FileState } from 'ember-file-upload/upload-file';

export interface UploadOptions {
  url?: string;
  method?: string;
  accepts?: string[];
  headers?: Record<string, string>;
  fileKey?: string;
  contentType?: string;
  data?: Record<string, string | File>;
  withCredentials?: boolean;
  timeout?: number;
}

const uploadWaiter = buildWaiter('ember-file-upload:upload');

function clone(object: object | undefined) {
  return object ? { ...object } : {};
}

function normalizeOptions(
  file: UploadFile,
  url: string | object | undefined,
  options?: UploadOptions
) {
  if (typeof url === 'object') {
    options = url;
    url = undefined;
  }

  options = clone(options);

  options.url = options.url || url;
  options.method = options.method || 'POST';
  options.accepts = options.accepts || ['application/json', 'text/javascript'];
  if (!Object.prototype.hasOwnProperty.call(options, 'contentType')) {
    options.contentType = file.type;
  }
  options.headers = clone(options.headers);
  options.data = clone(options.data);
  options.fileKey = options.fileKey || 'file';

  if (options.headers.Accept == null) {
    if (!Array.isArray(options.accepts)) {
      options.accepts = [options.accepts];
    }
    options.headers.Accept = options.accepts.join(',');
  }

  // Set Content-Type in the data payload
  // instead of the headers, since the header
  // for Content-Type will always be multipart/form-data
  if (options.contentType) {
    options.data['Content-Type'] = options.contentType;
  }

  options.data[options.fileKey] = file.file;

  options.withCredentials = options.withCredentials || false;

  return options;
}

export function upload(
  file: UploadFile,
  url: string | object,
  opts: UploadOptions | undefined,
  uploadFn: (
    request: HTTPRequest,
    options: UploadOptions
  ) => Promise<HTTPRequestResponse>
) {
  if (['queued', 'failed', 'timed_out', 'aborted'].indexOf(file.state) === -1) {
    assert(
      `The file ${file.id} is in the state "${file.state}" and cannot be requeued.`
    );
  }

  const options = normalizeOptions(file, url, opts);

  const request = new HTTPRequest({
    withCredentials: options.withCredentials,
    label: `${options.method} ${file.name} to ${options.url}`,
  });

  request.open(options.method ?? 'POST', options.url ?? '', true, '', '');

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  Object.keys(options.headers).forEach(function (key) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    request.setRequestHeader(key, options.headers[key]);
  });

  if (options.timeout) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    request.timeout = options.timeout;
  }

  request.onprogress = function (evt) {
    if (!evt) return;
    if (!evt.lengthComputable || evt.total === 0) return;

    file.loaded = evt.loaded;
    file.size = evt.total;
    file.progress = (evt.loaded / evt.total) * 100;
  };

  request.ontimeout = () => {
    file.state = FileState.TimedOut;
  };
  request.onabort = () => {
    file.state = FileState.Aborted;
  };
  file.state = FileState.Uploading;

  const token = uploadWaiter.beginAsync();

  return uploadFn(request, options)
    .then(
      function (response) {
        file.state = FileState.Uploaded;
        return response;
      },
      function (error) {
        file.state = FileState.Failed;
        return RSVP.reject(error);
      }
    )
    .finally(() => uploadWaiter.endAsync(token));
}
