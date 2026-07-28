using Awake.Application.Common.Interfaces;
using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Queries.GetMapModel;

public class GetMapModelQueryHandler(IMapAssetService mapAssetService)
    : IRequestHandler<GetMapModelQuery, Result<string>>
{
    public Task<Result<string>> Handle(GetMapModelQuery request, CancellationToken cancellationToken)
    {
        var path = mapAssetService.GetModelPath(request.Location);
        return Task.FromResult(path is not null
            ? Result<string>.Success(path)
            : Result<string>.Failure("Модель локации не найдена."));
    }
}
