'use strict';
// Module ids the project bridge probes. Paths match Muqian-Sun/xiangsu-mcp-plus
// editor-plugin/features/common.cjs (MIT, Copyright (c) 2026 muqian).

const M = {
  ef: '@orion/orion-sdk/EditorFramework',
  scene: '@orion/Business/Common/Scene',
  ipc: '@orion/Business/MultipleProjects/ProcessCommunication/IPCCommands',
  sender: '@orion/Business/MultipleProjects/ProcessCommunication/EditProcess/EditSender',
  analytics: '@orion/Business/Analytics/AnalyticsBusiness',
  orionui: '@orion/orion-sdk/orionui',
  editWindow: '@orion/Business/EditWindow/EditWindowController',
  musicCategory: '@orion/Business/EditWindow/Inspector/MusicLibrary/Model/MusicCategoryModel',
  musicList: '@orion/Business/EditWindow/Inspector/MusicLibrary/Model/MusicListModel',
  musicSquare: '@orion/Business/EditWindow/Inspector/MusicLibrary/Component/MusicListComponent/MusicSquareManager',
  iconPreview: '@orion/Business/IconCreationNew/controller/IconPreviewManager',
  iconWindow: '@orion/Business/IconCreationNew/IconCreationWindow',
  iconUpload: '@orion/Business/IconCreationNew/UI/BottomPanel/DYEHIconUploadHelper',
};

module.exports = { M };
