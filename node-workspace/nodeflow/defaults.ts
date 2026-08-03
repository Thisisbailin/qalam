import type {
  AnnotationNodeData,
  AudioInputNodeData,
  FolderNodeData,
  IdentityCardNodeData,
  ImageGenNodeData,
  ImageInputNodeData,
  MarkdownTextNodeData,
  NodeFlowNodeData,
  NodeType,
  PdfInputNodeData,
  PinoardNodeData,
  ScriptPageNodeData,
  ScriptBoardNodeData,
  SeedanceVideoGenNodeData,
  TextNodeData,
  ViduVideoGenNodeData,
  VideoInputNodeData,
  VideoGenNodeData,
} from "../types";

export const createDefaultNodeFlowNodeData = (type: NodeType): NodeFlowNodeData => {
  switch (type) {
    case "pinoard":
      return {
        title: "Pinoard",
        wrapperCollapsed: false,
      } as PinoardNodeData;
    case "folder":
      return {
        title: "文件夹",
      } as FolderNodeData;
    case "scriptPage":
      return {
        title: "剧本文档",
        text: "",
        documentId: undefined,
        documentKind: "script",
        format: "fountain",
        episodeId: undefined,
        preview: "",
      } as ScriptPageNodeData;
    case "mdText":
      return {
        title: "档案文档",
        text: "",
        content: "",
        documentId: undefined,
        documentKind: "archive",
        format: "markdown",
        preview: "",
      } as MarkdownTextNodeData;
    case "imageInput":
      return {
        image: null,
        filename: null,
        mimeType: null,
        storageBucket: null,
        storagePath: null,
        dimensions: null,
        assetAuditStatus: "idle",
        assetAuditMessage: null,
        assetAuditCheckedAt: null,
        assetId: null,
        assetUri: null,
        assetGroupId: null,
        assetSourceUrl: null,
        assetSourceBucket: null,
        assetSourcePath: null,
        label: "",
      } as ImageInputNodeData;
    case "audioInput":
      return {
        audio: null,
        filename: null,
        mimeType: null,
        durationMs: null,
        label: "",
      } as AudioInputNodeData;
    case "videoInput":
      return {
        video: null,
        filename: null,
        mimeType: null,
        durationMs: null,
        dimensions: null,
        aspectRatio: null,
        resolution: null,
        model: null,
        label: "",
      } as VideoInputNodeData;
    case "pdfInput":
      return {
        pdf: null,
        filename: null,
        storageBucket: null,
        storagePath: null,
        mimeType: "application/pdf",
        fileSize: null,
        highlights: [],
        label: "",
      } as PdfInputNodeData;
    case "annotation":
      return {
        sourceImage: null,
        annotations: [],
        outputImage: null,
      } as AnnotationNodeData;
    case "text":
      return {
        title: "文本",
        text: "",
        documentId: undefined,
        documentKind: "note",
        format: "markdown",
      } as TextNodeData;
    case "scriptBoard":
      return {
        title: "剧本面板",
      } as ScriptBoardNodeData;
    case "lookbook":
    case "identityCard":
      return {
        title: "Lookbook",
        avatarOverrides: {},
      } as IdentityCardNodeData;
    case "imageGen":
      return {
        inputImages: [],
        outputImage: null,
        status: "idle",
        error: null,
        aspectRatio: "1:1",
        taskRequestedAt: null,
        taskSubmittedAt: null,
        processingStartedAt: null,
        taskCompletedAt: null,
        taskState: null,
        progressPercent: null,
        progressLabel: null,
        progressHint: null,
      } as ImageGenNodeData;
    case "nanoBananaImageGen":
      return {
        inputImages: [],
        outputImage: null,
        versionHistory: [],
        status: "idle",
        error: null,
        aspectRatio: "1:1",
        model: "nano banana pro",
        taskRequestedAt: null,
        taskSubmittedAt: null,
        processingStartedAt: null,
        taskCompletedAt: null,
        taskState: null,
        progressPercent: null,
        progressLabel: null,
        progressHint: null,
      } as ImageGenNodeData;
    case "wanImageGen":
      return {
        inputImages: [],
        outputImage: null,
        status: "idle",
        error: null,
        aspectRatio: "1:1",
        model: "wan2.6-image",
        enableInterleave: false,
        watermark: false,
        outputCount: 1,
      } as ImageGenNodeData;
    case "wanReferenceVideoGen":
      return {
        inputImages: [],
        referenceImages: [],
        referenceVideos: [],
        referenceAudios: [],
        referenceVoiceTarget: null,
        firstFrameImage: null,
        projectReferenceTargets: [],
        videoId: undefined,
        videoUrl: undefined,
        status: "idle",
        error: null,
        aspectRatio: "16:9",
        duration: "5s",
        model: "wan2.7-r2v",
        resolution: "1080P",
        watermark: false,
      } as VideoGenNodeData;
    case "viduVideoGen":
      return {
        inputImages: [],
        videoId: undefined,
        videoUrl: undefined,
        status: "idle",
        error: null,
        progressPercent: null,
        progressLabel: null,
        progressHint: null,
        taskState: null,
        taskRequestedAt: null,
        taskSubmittedAt: null,
        processingStartedAt: null,
        taskCompletedAt: null,
        lastCreditsCost: null,
        authProbeStatus: "idle",
        authProbeSummary: null,
        authProbeDetail: null,
        mode: "subject",
        useCharacters: true,
        autoSubjects: false,
        aspectRatio: "16:9",
        resolution: "720p",
        duration: 5,
        audioEnabled: true,
        offPeak: false,
        watermark: false,
        bgm: false,
        model: "viduq3",
      } as ViduVideoGenNodeData;
    case "seedanceVideoGen":
      return {
        inputImages: [],
        referenceVideos: [],
        referenceAudios: [],
        videoId: undefined,
        videoUrl: undefined,
        status: "idle",
        error: null,
        model: "doubao-seedance-2-0-260128",
        mode: "multimodalReference",
        resolution: "720p",
        ratio: "adaptive",
        duration: 5,
        generateAudio: true,
        watermark: false,
      } as SeedanceVideoGenNodeData;
  }
};
