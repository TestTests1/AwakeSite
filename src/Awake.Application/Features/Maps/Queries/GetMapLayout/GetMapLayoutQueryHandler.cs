using Awake.Application.Common.Interfaces.Repositories;
using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Queries.GetMapLayout;

public class GetMapLayoutQueryHandler(IMapLayoutRepository layouts)
    : IRequestHandler<GetMapLayoutQuery, Result<MapLayoutDto>>
{
    public async Task<Result<MapLayoutDto>> Handle(
        GetMapLayoutQuery request, CancellationToken cancellationToken)
    {
        var layout = await layouts.GetByIdAsync(request.Id, cancellationToken);
        if (layout is null)
            return Result<MapLayoutDto>.Failure("Расстановка не найдена.");

        return Result<MapLayoutDto>.Success(new MapLayoutDto(
            layout.Id,
            layout.Location,
            layout.Name,
            layout.Props,
            layout.AuthorId,
            layout.Author?.Username ?? "—",
            layout.CreatedAt,
            layout.UpdatedAt));
    }
}
